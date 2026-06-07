/**
 * checkpoint.ts — Git snapshot checkpoint + Auto file-change tracking
 *
 * Two subsystems coexist:
 *   1. Manual Git stash snapshots (create/restore) — for pre-destructive ops
 *   2. Auto file-change checkpoints (autoCreate/list/get/cleanup) — for /rewind
 *
 * Auto-checkpoints are created in fire-and-forget mode after every Write/Edit.
 * They persist as JSONL lines in ~/.coder/checkpoints/<sessionId>.jsonl.
 *
 * Content truncation rules:
 *   · ≤10KB → full content stored
 *   · >10KB → first 5KB + last 5KB with "[... truncated ...]" marker
 *   · >1MB → only SHA-256 hash stored (content discarded)
 *
 * FileHistory-based checkpoint mechanism.
 */

import { exec } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync, createReadStream, statSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types (manual Git checkpoint)
// ---------------------------------------------------------------------------

export interface Checkpoint {
  id: string;
  sessionId: string;
  createdAt: string;
  description: string;
  /** Git commit hash at checkpoint time */
  commitHash?: string;
  /** Files changed since this checkpoint */
  changedFiles: string[];
  /** Stash reference (if using git stash) */
  stashRef?: string;
}

export interface CheckpointCreateOptions {
  sessionId: string;
  cwd: string;
  description?: string;
}

export interface CheckpointRestoreResult {
  success: boolean;
  checkpointId: string;
  restoredFiles: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Types (auto file-change checkpoint)
// ---------------------------------------------------------------------------

export interface AutoCheckpointEntry {
  id: string;
  sessionId: string;
  turnNumber: number;
  timestamp: Date;
  toolName: string;          // 'Write' | 'Edit'
  filePath: string;           // Absolute path to the modified file
  contentBefore?: string;     // File content before the change (truncated per rules)
  contentAfter?: string;      // File content after the change (truncated per rules)
  diff?: string;              // Unified diff
  contentHash?: string;       // SHA-256 when content was too large (>1MB)
  message?: string;           // Auto-generated summary
}

export interface AutoCheckpointCreateInput {
  sessionId: string;
  turnNumber: number;
  toolName: string;
  filePath: string;
  cwd: string;
  /** Content before tool execution (the Read returned this) */
  contentBefore?: string;
  /** Read content from disk after execution (default: true) */
  readAfter?: boolean;
}

export interface AutoCheckpointListOptions {
  limit?: number;
  before?: Date;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEN_KB = 10 * 1024;
const ONE_MB = 1024 * 1024;
const DEFAULT_CLEANUP_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ---------------------------------------------------------------------------
// Checkpoint Manager
// ---------------------------------------------------------------------------

export class CheckpointManager {
  private checkpoints: Map<string, Checkpoint> = new Map();

  // =========================================================================
  // Manual Git checkpoint API (existing, unchanged)
  // =========================================================================

  /**
   * Create a Git stash-based snapshot.
   */
  async create(options: CheckpointCreateOptions): Promise<Checkpoint> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    const checkpoint: Checkpoint = {
      id,
      sessionId: options.sessionId,
      createdAt,
      description: options.description ?? `Checkpoint ${id.slice(0, 8)}`,
      changedFiles: [],
    };

    try {
      // Get current commit hash
      const commitHash = await this.gitExec(options.cwd, 'git rev-parse HEAD');

      // Create stash of current changes (including untracked)
      // Only stash if there are changes
      const status = await this.gitExec(options.cwd, 'git status --porcelain');
      if (status.trim()) {
        const stashResult = await this.gitExec(options.cwd, 'git stash create');
        checkpoint.stashRef = stashResult.trim();
      }

      // Get list of changed files
      const diffFiles = await this.gitExec(options.cwd, 'git diff --name-only HEAD');
      const untrackedFiles = await this.gitExec(options.cwd, 'git ls-files --others --exclude-standard');
      checkpoint.changedFiles = [
        ...diffFiles.trim().split('\n').filter(Boolean),
        ...untrackedFiles.trim().split('\n').filter(Boolean),
      ];

      checkpoint.commitHash = commitHash.trim();
    } catch (err) {
      // Non-git directory — create an empty checkpoint
      checkpoint.commitHash = undefined;
    }

    // Persist to disk
    this.saveCheckpoint(options.sessionId, checkpoint);
    this.checkpoints.set(id, checkpoint);

    return checkpoint;
  }

  /**
   * Restore to a previous checkpoint using git stash pop.
   */
  async restore(checkpointId: string, cwd: string): Promise<CheckpointRestoreResult> {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      return { success: false, checkpointId, restoredFiles: [], error: 'Checkpoint not found' };
    }

    try {
      // Discard current changes
      await this.gitExec(cwd, 'git checkout -- .');
      await this.gitExec(cwd, 'git clean -fd');

      // Pop the stash if available
      if (checkpoint.stashRef) {
        await this.gitExec(cwd, `git stash pop ${checkpoint.stashRef}`);
      }

      return {
        success: true,
        checkpointId,
        restoredFiles: checkpoint.changedFiles,
      };
    } catch (err) {
      return {
        success: false,
        checkpointId,
        restoredFiles: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * List all Git-stash checkpoints for a session.
   */
  listGitCheckpoints(sessionId: string): Checkpoint[] {
    return this.list(sessionId);
  }

  /**
   * Load checkpoints from disk for a session.
   */
  loadFromDisk(sessionId: string): Checkpoint[] {
    const dir = getSessionDir(sessionId);
    const path = join(dir, 'checkpoints.json');

    if (!existsSync(path)) return [];

    try {
      const data = JSON.parse(readFileSync(path, 'utf-8')) as Checkpoint[];
      for (const ck of data) {
        this.checkpoints.set(ck.id, ck);
      }
      return data;
    } catch {
      return [];
    }
  }

  // =========================================================================
  // Auto file-change checkpoint API (NEW)
  // =========================================================================

  /**
   * Automatically create a file-change checkpoint after Write/Edit success.
   *
   * Non-blocking by design — callers should fire-and-forget.
   * All errors are caught and logged to stderr (never thrown).
   *
   * Content truncation:
   *   · ≤10KB → full content
   *   · >10KB → first 5KB + last 5KB
   *   · >1MB  → SHA-256 hash only
   */
  async autoCreate(input: AutoCheckpointCreateInput): Promise<AutoCheckpointEntry | null> {
    const id = randomUUID();
    const timestamp = new Date();

    const entry: AutoCheckpointEntry = {
      id,
      sessionId: input.sessionId,
      turnNumber: input.turnNumber,
      timestamp,
      toolName: input.toolName,
      filePath: input.filePath,
    };

    try {
      // ── Read file content before (if provided) ──────────────────────
      if (input.contentBefore !== undefined) {
        entry.contentBefore = this.truncateContent(input.contentBefore, input.filePath);
      }

      // ── Read file content after (from disk) ─────────────────────────
      if (input.readAfter !== false && existsSync(input.filePath)) {
        const stat = statSync(input.filePath);
        if (stat.size > ONE_MB) {
          // Too large — store hash only
          entry.contentHash = await this.sha256File(input.filePath);
          entry.message = `File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB), hash: ${entry.contentHash.slice(0, 16)}`;
        } else {
          const raw = readFileSync(input.filePath, 'utf-8');
          entry.contentAfter = this.truncateContent(raw, input.filePath);
        }
      }

      // ── Generate diff ───────────────────────────────────────────────
      if (entry.contentBefore !== undefined && entry.contentAfter !== undefined) {
        // Lazy-import diff to avoid circular dependency issues at module load
        const { unifiedDiff } = await import('@coder/shared');
        const diff = unifiedDiff(
          entry.contentBefore,
          entry.contentAfter,
          `--- a/${input.filePath}`,
          `+++ b/${input.filePath}`,
        );
        if (diff) {
          // Truncate diff to reasonable size (50KB max)
          entry.diff = diff.length > 50 * 1024
            ? diff.slice(0, 25 * 1024) + '\n[... diff truncated ...]\n' + diff.slice(-25 * 1024)
            : diff;
        }
      } else if (entry.contentHash) {
        entry.diff = `[binary / large file — hash: ${entry.contentHash}]`;
      }

      // ── Auto-generate message ───────────────────────────────────────
      if (!entry.message) {
        const fileName = input.filePath.split('/').pop() ?? input.filePath;
        const changeDesc = entry.diff
          ? `(${entry.diff.split('\n').filter(l => l.startsWith('+')).length} additions, ${entry.diff.split('\n').filter(l => l.startsWith('-')).length} deletions)`
          : '';
        entry.message = `${input.toolName}: ${fileName} ${changeDesc}`.trim();
      }

      // ── Persist to JSONL ────────────────────────────────────────────
      this.appendAutoCheckpoint(input.sessionId, entry);

      // ── Periodic cleanup ────────────────────────────────────────────
      void this.cleanup(input.sessionId).catch(() => {
        // Cleanup failures are non-fatal
      });

      return entry;
    } catch (err) {
      // Silent failure — autoCreate must never throw
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[checkpoint] autoCreate failed for ${input.filePath}: ${msg}\n`);
      return null;
    }
  }

  /**
   * List auto-checkpoints for a session (newest first).
   */
  async listAutoCheckpoints(
    sessionId: string,
    options?: AutoCheckpointListOptions,
  ): Promise<AutoCheckpointEntry[]> {
    const path = getAutoCheckpointPath(sessionId);
    if (!existsSync(path)) return [];

    const entries: AutoCheckpointEntry[] = [];

    try {
      // Read JSONL line by line, newest first (reverse)
      const allLines = readFileSync(path, 'utf-8')
        .split('\n')
        .filter(Boolean);

      for (let i = allLines.length - 1; i >= 0; i--) {
        const line = allLines[i]!;
        try {
          const entry = JSON.parse(line) as AutoCheckpointEntry;
          // Parse timestamp back to Date
          entry.timestamp = new Date(entry.timestamp);

          // Filter by 'before' option
          if (options?.before && entry.timestamp >= options.before) continue;

          entries.push(entry);

          // Respect limit
          if (options?.limit && entries.length >= options.limit) break;
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      return [];
    }

    return entries;
  }

  /**
   * Get a single auto-checkpoint by ID.
   *
   * Scans the JSONL file — efficient for occasional lookups.
   * For frequent access, consider an in-memory index.
   */
  async getAutoCheckpoint(id: string): Promise<AutoCheckpointEntry | null> {
    // We need the sessionId to know which file to scan.
    // Strategy: load from memory first, then scan all session files.
    // For now, scan the last 5 session dirs (most likely to hit).

    const checkpointsDir = join(homedir(), '.coder', 'checkpoints');
    if (!existsSync(checkpointsDir)) return null;

    const files = readdirSync(checkpointsDir)
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .reverse()
      .slice(0, 10); // Scan last 10 sessions

    for (const file of files) {
      const path = join(checkpointsDir, file);
      try {
        const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
        // Search from end (newest first)
        for (let i = lines.length - 1; i >= 0; i--) {
          const entry = JSON.parse(lines[i]!) as AutoCheckpointEntry;
          if (entry.id === id) {
            entry.timestamp = new Date(entry.timestamp);
            return entry;
          }
        }
      } catch {
        // Skip malformed files
      }
    }

    return null;
  }

  /**
   * Clean up auto-checkpoints older than maxAge (default: 30 days).
   *
   * Returns the number of entries deleted.
   * Called automatically after each autoCreate, and can be called manually.
   */
  async cleanup(sessionId?: string, maxAge = DEFAULT_CLEANUP_AGE_MS): Promise<number> {
    const checkpointsDir = join(homedir(), '.coder', 'checkpoints');
    if (!existsSync(checkpointsDir)) return 0;

    const cutoff = Date.now() - maxAge;
    let deleted = 0;

    const files = sessionId
      ? [`${sessionId}.jsonl`].filter(f => existsSync(join(checkpointsDir, f)))
      : readdirSync(checkpointsDir).filter(f => f.endsWith('.jsonl'));

    for (const file of files) {
      const path = join(checkpointsDir, file);
      try {
        const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
        const kept: string[] = [];

        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as AutoCheckpointEntry;
            const ts = new Date(entry.timestamp).getTime();
            if (ts < cutoff) {
              deleted++;
            } else {
              kept.push(line);
            }
          } catch {
            // Malformed line — drop it
            deleted++;
          }
        }

        if (kept.length === 0) {
          // Remove empty file
          unlinkSync(path);
        } else {
          writeFileSync(path, kept.join('\n') + '\n', 'utf-8');
        }
      } catch {
        // File may have been deleted between check and read
      }
    }

    return deleted;
  }

  // -----------------------------------------------------------------------
  // Public: list (backward-compatible with old API)
  // -----------------------------------------------------------------------

  /**
   * List all Git-stash checkpoints for a session.
   *
   * NOTE: This returns only manual Git checkpoints.
   * Use listAutoCheckpoints() for auto file-change checkpoints.
   */
  list(sessionId: string): Checkpoint[] {
    return Array.from(this.checkpoints.values())
      .filter((c) => c.sessionId === sessionId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Truncate file content according to rules:
   *   ≤10KB → return as-is
   *   >10KB → first 5KB + last 5KB with marker
   */
  private truncateContent(content: string, _filePath: string): string {
    const len = Buffer.byteLength(content, 'utf-8');
    if (len <= TEN_KB) return content;

    const first = content.slice(0, 5 * 1024);
    const last = content.slice(-5 * 1024);
    return `${first}\n\n[... ${((len - TEN_KB) / 1024).toFixed(1)}KB truncated ...]\n\n${last}`;
  }

  /**
   * Compute SHA-256 hash of a file (for large files >1MB).
   */
  private sha256File(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk as Buffer));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Append an auto-checkpoint entry as a JSONL line.
   */
  private appendAutoCheckpoint(sessionId: string, entry: AutoCheckpointEntry): void {
    const dir = join(homedir(), '.coder', 'checkpoints');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const path = join(dir, `${sessionId}.jsonl`);
    const line = JSON.stringify(entry) + '\n';
    appendFileSync(path, line, 'utf-8');
  }

  private saveCheckpoint(sessionId: string, checkpoint: Checkpoint): void {
    const dir = getSessionDir(sessionId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const path = join(dir, 'checkpoints.json');
    const existing = this.loadFromDisk(sessionId);
    existing.unshift(checkpoint); // Newest first

    writeFileSync(path, JSON.stringify(existing, null, 2), 'utf-8');
  }

  private gitExec(cwd: string, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(command, { cwd, timeout: 10_000 }, (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSessionDir(sessionId: string): string {
  return join(homedir(), '.coder', 'sessions', sessionId);
}

function getAutoCheckpointPath(sessionId: string): string {
  return join(homedir(), '.coder', 'checkpoints', `${sessionId}.jsonl`);
}
