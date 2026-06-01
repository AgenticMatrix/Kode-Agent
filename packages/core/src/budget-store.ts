/**
 * budget-store.ts — Tool Result Budget: disk offload for large outputs
 *
 * Prevents large tool outputs from consuming the LLM context budget.
 * Three-layer strategy:
 *
 *   Level 1 — Single result >50K chars:
 *     Write to disk, replace with preview + file_id reference
 *
 *   Level 2 — Aggregate >200K chars:
 *     Batch-offload all results, produce index summary
 *
 *   Level 3 — Three-zone freeze:
 *     mustReapply: always include in API calls
 *     frozen:       disk-offloaded, skipped in API calls
 *     fresh:        new results, passed to API (may be Level-1 truncated)
 *
 * Design principles:
 *   - Async non-blocking: disk writes are synchronous for now (kept simple)
 *     but the caller fires them in a fire-and-forget style
 *   - Memory-safe: large content is written to disk, not held in memory
 *   - Path: ~/.kode/tool-results/<sessionId>/<fileId>.txt
 *   - fileId format: tool_<toolUseId>_<timestamp>
 *
 * Tool Result Budget stage in the context compactor pipeline.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Single result above this threshold triggers offload */
const SINGLE_RESULT_THRESHOLD = 50 * 1024; // 50KB chars

/** Aggregate tool results above this trigger batch offload */
const AGGREGATE_THRESHOLD = 200 * 1024; // 200KB chars

/** Number of preview characters to keep in-memory */
const PREVIEW_LENGTH = 500;

/** Default cleanup age: 7 days */
const DEFAULT_CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BudgetEntry {
  fileId: string;
  sessionId: string;
  toolUseId: string;
  toolName: string;
  originalSize: number;
  truncated: boolean;
  filePath: string;           // Absolute disk path
  preview: string;            // First PREVIEW_LENGTH chars
}

export interface MaybeOffloadResult {
  content: string;            // Replacement content (preview + ref or original)
  entry?: BudgetEntry;        // Non-null if the result was offloaded
}

// ---------------------------------------------------------------------------
// BudgetStore
// ---------------------------------------------------------------------------

export class BudgetStore {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(homedir(), '.kode', 'tool-results');
  }

  // -----------------------------------------------------------------------
  // Level 1: Single-result offload
  // -----------------------------------------------------------------------

  /**
   * If `result` exceeds SINGLE_RESULT_THRESHOLD (50KB), write it to disk
   * and return a truncated preview. Otherwise return the original content.
   *
   * @param toolUseId  — tool_use block ID from the assistant message
   * @param toolName   — tool name (e.g. "Bash", "Grep", "Read")
   * @param result     — the raw tool output string
   * @param sessionId  — current session ID
   */
  maybeOffload(
    toolUseId: string,
    toolName: string,
    result: string,
    sessionId: string,
  ): MaybeOffloadResult {
    const size = Buffer.byteLength(result, 'utf-8');

    // Under threshold — return as-is
    if (size <= SINGLE_RESULT_THRESHOLD) {
      return { content: result };
    }

    // ── Offload: write to disk, keep preview ──────────────────────────
    const fileId = `tool_${toolUseId}_${Date.now()}`;
    const sessionDir = this.ensureSessionDir(sessionId);
    const filePath = join(sessionDir, `${fileId}.txt`);

    const preview = result.slice(0, PREVIEW_LENGTH);
    const truncatedContent = this.buildTruncatedMessage(preview, fileId, size);

    const entry: BudgetEntry = {
      fileId,
      sessionId,
      toolUseId,
      toolName,
      originalSize: size,
      truncated: true,
      filePath,
      preview,
    };

    // Write full result to disk (synchronous for simplicity — called
    // from the Agent Loop synchronously so we don't race with cleanup).
    try {
      writeFileSync(filePath, result, 'utf-8');
    } catch (err) {
      // Disk write failed — fall back to original content
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[budget-store] write failed for ${fileId}: ${msg}\n`);
      return { content: result };
    }

    return { content: truncatedContent, entry };
  }

  // -----------------------------------------------------------------------
  // Level 2: Aggregate offload
  // -----------------------------------------------------------------------

  /**
   * Check whether the combined tool results exceed the aggregate threshold
   * (200KB). If so, all results should be batch-offloaded.
   */
  shouldAggregateOffload(results: string[], threshold?: number): boolean {
    const total = results.reduce((sum, r) => sum + Buffer.byteLength(r, 'utf-8'), 0);
    return total > (threshold ?? AGGREGATE_THRESHOLD);
  }

  /**
   * Batch-offload all results and return an index summary.
   *
   * @returns replacement content (index summary) and list of all entries
   */
  batchOffload(
    results: Array<{ toolUseId: string; toolName: string; content: string }>,
    sessionId: string,
  ): { content: string; entries: BudgetEntry[] } {
    const entries: BudgetEntry[] = [];
    const indexLines: string[] = [
      `[BudgetStore] ${results.length} tool results offloaded to disk (aggregate threshold exceeded):`,
      '',
    ];

    for (const r of results) {
      const size = Buffer.byteLength(r.content, 'utf-8');
      const fileId = `tool_${r.toolUseId}_${Date.now()}`;
      const sessionDir = this.ensureSessionDir(sessionId);
      const filePath = join(sessionDir, `${fileId}.txt`);

      const preview = r.content.slice(0, PREVIEW_LENGTH);

      entries.push({
        fileId,
        sessionId,
        toolUseId: r.toolUseId,
        toolName: r.toolName,
        originalSize: size,
        truncated: true,
        filePath,
        preview,
      });

      try {
        writeFileSync(filePath, r.content, 'utf-8');
      } catch {
        // Fall back gracefully
      }

      indexLines.push(
        `  [${r.toolName}] ${fileId} — ${(size / 1024).toFixed(1)}KB — use BudgetStore.readFull("${fileId}") to retrieve`,
      );
    }

    indexLines.push('');
    indexLines.push('Preview of first result:');
    indexLines.push(entries[0]?.preview ?? '(empty)');

    return { content: indexLines.join('\n'), entries };
  }

  // -----------------------------------------------------------------------
  // Read full result
  // -----------------------------------------------------------------------

  /**
   * Read the full (untruncated) tool result from disk.
   *
   * @returns full content string, or null if not found / already cleaned up
   */
  readFull(fileId: string, sessionId?: string): string | null {
    // If sessionId is provided, try that session dir first
    if (sessionId) {
      const path = join(this.baseDir, sessionId, `${fileId}.txt`);
      if (existsSync(path)) {
        try {
          return readFileSync(path, 'utf-8');
        } catch {
          // Fall through to scan
        }
      }
    }

    // Scan all session dirs
    if (!existsSync(this.baseDir)) return null;

    try {
      for (const dir of readdirSync(this.baseDir, { withFileTypes: true })) {
        if (!dir.isDirectory()) continue;
        const path = join(this.baseDir, dir.name, `${fileId}.txt`);
        if (existsSync(path)) {
          return readFileSync(path, 'utf-8');
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Remove tool result files older than maxAge (default: 7 days).
   *
   * @returns number of files deleted
   */
  cleanup(maxAge = DEFAULT_CLEANUP_AGE_MS): number {
    if (!existsSync(this.baseDir)) return 0;

    const cutoff = Date.now() - maxAge;
    let deleted = 0;

    try {
      for (const dir of readdirSync(this.baseDir, { withFileTypes: true })) {
        if (!dir.isDirectory()) continue;
        const sessionDir = join(this.baseDir, dir.name);

        try {
          for (const file of readdirSync(sessionDir)) {
            if (!file.endsWith('.txt')) continue;
            const filePath = join(sessionDir, file);

            // Parse timestamp from fileId: tool_<toolUseId>_<timestamp>
            const tsMatch = file.match(/_(\d{13})\.txt$/);
            if (tsMatch) {
              const ts = parseInt(tsMatch[1]!, 10);
              if (ts < cutoff) {
                try {
                  unlinkSync(filePath);
                  deleted++;
                } catch {
                  // Already deleted or permission error
                }
              }
            }
          }

          // Remove empty session dirs
          const remaining = readdirSync(sessionDir);
          if (remaining.length === 0) {
            try {
              unlinkSync(sessionDir);
            } catch {
              // May still have hidden files
            }
          }
        } catch {
          // Skip malformed session dirs
        }
      }
    } catch {
      // Base dir issues
      return deleted;
    }

    return deleted;
  }

  // -----------------------------------------------------------------------
  // Zone helpers
  // -----------------------------------------------------------------------

  /**
   * Check whether a tool result has been offloaded (i.e. its content is
   * a truncated preview rather than the full output).
   *
   * Heuristic: if the content starts with "[BudgetStore]" or contains a
   * file_id reference, it's been offloaded.
   */
  isOffloaded(content: string): boolean {
    return content.startsWith('[BudgetStore]') || content.includes('(truncated — use BudgetStore');
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private ensureSessionDir(sessionId: string): string {
    const dir = join(this.baseDir, sessionId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private buildTruncatedMessage(preview: string, fileId: string, originalSize: number): string {
    const sizeStr =
      originalSize >= 1024 * 1024
        ? `${(originalSize / (1024 * 1024)).toFixed(1)}MB`
        : `${(originalSize / 1024).toFixed(1)}KB`;

    return [
      `[BudgetStore] Output truncated (${sizeStr}) — use BudgetStore.readFull("${fileId}") to retrieve full content`,
      '',
      preview,
      '',
      `... ${sizeStr} truncated ...`,
    ].join('\n');
  }
}
