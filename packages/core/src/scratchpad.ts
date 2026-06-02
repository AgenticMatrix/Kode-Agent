/**
 * Scratchpad — Shared filesystem for cross-Worker communication
 *
 * Provides a persistent, shared directory (~/.coder/scratchpad/) where
 * Worker agents can read and write files without permission approval.
 *
 * Features:
 *   - Per-agent directories for private scratch files
 *   - Shared directory for cross-Worker data exchange
 *   - Version control via .v<N> suffix
 *   - File-level locking to prevent concurrent write corruption
 *   - Atomic writes (tmp → rename, mirroring MemoryStore pattern)
 *   - Auto-cleanup of files older than 24h
 *
 * Architecture reference: ARCHITECTURE.md §4.8e
 */

import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  unlinkSync,
  statSync,
  rmSync,
  copyFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BASE_DIR = join(homedir(), '.coder', 'scratchpad');
const SHARED_DIR_NAME = 'shared';
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const LOCK_POLL_INTERVAL_MS = 100;
const LOCK_MAX_WAIT_MS = 10_000; // 10 seconds max lock wait

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VersionEntry {
  version: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Scratchpad
// ---------------------------------------------------------------------------

export class Scratchpad {
  private baseDir: string;
  private locks: Map<string, Promise<void>> = new Map();

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? DEFAULT_BASE_DIR;
    this.ensureDir(this.baseDir);
    this.ensureDir(join(this.baseDir, SHARED_DIR_NAME));
  }

  // ── File Operations (per-agent) ──────────────────────────────────

  /**
   * Write content to a file in the agent's private scratch directory.
   * Uses atomic write: writes to .tmp then renames to prevent corruption.
   *
   * @param agentId - Owning agent identifier
   * @param filename - Filename (not path, validated to prevent traversal)
   * @param content - Content to write
   * @returns Absolute path to the written file
   */
  async writeFile(agentId: string, filename: string, content: string): Promise<string> {
    this.validateFilename(filename);

    const agentDir = join(this.baseDir, agentId);
    this.ensureDir(agentDir);

    const filePath = join(agentDir, filename);
    const lockPath = filePath + '.lock';

    await this.acquireLock(lockPath);
    try {
      // Version control: save current version before overwriting
      if (existsSync(filePath)) {
        this.archiveVersion(filePath);
      }

      // Atomic write: write to .tmp then rename
      const tmpPath = `${filePath}.coder-tmp-${randomUUID()}`;
      try {
        writeFileSync(tmpPath, content, 'utf-8');
        renameSync(tmpPath, filePath);
      } catch (err) {
        // Clean up temp file on failure
        try { unlinkSync(tmpPath); } catch { /* ignore */ }
        throw err;
      }

      return filePath;
    } finally {
      this.releaseLock(lockPath);
    }
  }

  /**
   * Read content from a file in the agent's private scratch directory.
   *
   * @returns File content as string, or null if the file does not exist.
   */
  async readFile(agentId: string, filename: string): Promise<string | null> {
    this.validateFilename(filename);

    const filePath = join(this.baseDir, agentId, filename);
    if (!existsSync(filePath)) return null;

    return readFileSync(filePath, 'utf-8');
  }

  /**
   * List all files in the agent's private scratch directory.
   */
  async listFiles(agentId: string): Promise<string[]> {
    const agentDir = join(this.baseDir, agentId);
    if (!existsSync(agentDir)) return [];

    try {
      return readdirSync(agentDir, { withFileTypes: true })
        .filter((e) => e.isFile() && !e.name.endsWith('.lock') && !e.name.endsWith('.tmp'))
        .map((e) => e.name);
    } catch {
      return [];
    }
  }

  // ── Version Control ──────────────────────────────────────────────

  /**
   * Get version history for a file.
   * Versions are stored as `<filename>.v<N>` in the same directory.
   */
  async getHistory(agentId: string, filename: string): Promise<VersionEntry[]> {
    const agentDir = join(this.baseDir, agentId);
    if (!existsSync(agentDir)) return [];

    const prefix = filename + '.v';
    const versions: VersionEntry[] = [];

    try {
      for (const entry of readdirSync(agentDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.startsWith(prefix)) {
          const versionStr = entry.name.slice(prefix.length);
          const version = parseInt(versionStr, 10);
          if (!isNaN(version)) {
            const stat = statSync(join(agentDir, entry.name));
            versions.push({
              version,
              timestamp: stat.mtime.toISOString(),
            });
          }
        }
      }
    } catch {
      // Directory might have been removed
    }

    return versions.sort((a, b) => b.version - a.version);
  }

  /**
   * Read a specific version of a file.
   *
   * @returns File content, or null if the version does not exist.
   */
  async getVersion(agentId: string, filename: string, version: number): Promise<string | null> {
    const versionPath = join(this.baseDir, agentId, `${filename}.v${version}`);
    if (!existsSync(versionPath)) return null;
    return readFileSync(versionPath, 'utf-8');
  }

  /**
   * Archive the current version before overwriting.
   * Finds the highest existing version number and saves as v<N+1>.
   */
  private archiveVersion(filePath: string): void {
    const dir = dirname(filePath);
    const baseName = filePath.split('/').pop()!;
    const history = this.syncGetHistory(dir, baseName);

    const nextVersion = history.length > 0 ? history[0]!.version + 1 : 1;

    // Keep at most 10 versions
    const versionPath = join(dir, `${baseName}.v${nextVersion}`);
    try {
      copyFileSync(filePath, versionPath);
    } catch {
      // If copy fails, skip versioning for this write
    }

    // Prune old versions (keep last 10)
    if (history.length >= 10) {
      const toRemove = history.slice(9);
      for (const entry of toRemove) {
        try { unlinkSync(join(dir, `${baseName}.v${entry.version}`)); } catch { /* ignore */ }
      }
    }
  }

  /**
   * Synchronous variant of getHistory for internal use.
   */
  private syncGetHistory(dir: string, filename: string): VersionEntry[] {
    const prefix = filename + '.v';
    const versions: VersionEntry[] = [];

    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.startsWith(prefix)) {
          const versionStr = entry.name.slice(prefix.length);
          const version = parseInt(versionStr, 10);
          if (!isNaN(version)) {
            const stat = statSync(join(dir, entry.name));
            versions.push({ version, timestamp: stat.mtime.toISOString() });
          }
        }
      }
    } catch { /* ignore */ }

    return versions.sort((a, b) => b.version - a.version);
  }

  // ── Lock Mechanism ───────────────────────────────────────────────

  /**
   * Acquire a file-level lock using a .lock marker file.
   * Polls every 100ms until the lock is released or timeout reached.
   */
  private async acquireLock(lockPath: string): Promise<void> {
    const existing = this.locks.get(lockPath);
    if (existing) {
      await existing;
      return this.acquireLock(lockPath);
    }

    const lockPromise = new Promise<void>((resolve, reject) => {
      const start = Date.now();

      const tryAcquire = (): void => {
        if (Date.now() - start > LOCK_MAX_WAIT_MS) {
          reject(new Error(`Lock timeout after ${LOCK_MAX_WAIT_MS}ms: ${lockPath}`));
          return;
        }

        try {
          // Try to create the lock file exclusively
          writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
          resolve();
        } catch {
          // Lock exists — poll
          setTimeout(tryAcquire, LOCK_POLL_INTERVAL_MS);
        }
      };

      tryAcquire();
    });

    this.locks.set(lockPath, lockPromise);

    try {
      await lockPromise;
    } finally {
      this.locks.delete(lockPath);
    }
  }

  /**
   * Release a file-level lock by removing the .lock marker file.
   */
  private releaseLock(lockPath: string): void {
    try {
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
      }
    } catch {
      // Best-effort cleanup
    }
  }

  // ── Shared Directory (cross-Worker) ──────────────────────────────

  /**
   * Write to the shared directory (accessible by all Workers).
   * Uses atomic write for safety.
   */
  async writeShared(filename: string, content: string): Promise<string> {
    this.validateFilename(filename);

    const sharedDir = join(this.baseDir, SHARED_DIR_NAME);
    this.ensureDir(sharedDir);

    const filePath = join(sharedDir, filename);
    const tmpPath = `${filePath}.coder-tmp-${randomUUID()}`;

    try {
      writeFileSync(tmpPath, content, 'utf-8');
      renameSync(tmpPath, filePath);
    } catch (err) {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
    }

    return filePath;
  }

  /**
   * Read from the shared directory.
   *
   * @returns File content, or null if the file does not exist.
   */
  async readShared(filename: string): Promise<string | null> {
    this.validateFilename(filename);

    const filePath = join(this.baseDir, SHARED_DIR_NAME, filename);
    if (!existsSync(filePath)) return null;

    return readFileSync(filePath, 'utf-8');
  }

  // ── Cleanup ──────────────────────────────────────────────────────

  /**
   * Remove files older than maxAgeMs (default: 24 hours).
   * Also cleans up stale .lock files.
   *
   * @returns Number of files removed.
   */
  async cleanup(maxAgeMs: number = DEFAULT_MAX_AGE_MS): Promise<number> {
    let removed = 0;
    const now = Date.now();

    const cleanDir = (dir: string): void => {
      if (!existsSync(dir)) return;

      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const fullPath = join(dir, entry.name);

          if (entry.isDirectory()) {
            // Recurse into agent directories
            cleanDir(fullPath);
            // Remove empty directories
            try {
              const remaining = readdirSync(fullPath);
              if (remaining.length === 0) {
                rmSync(fullPath, { recursive: true });
              }
            } catch { /* ignore */ }
            continue;
          }

          if (!entry.isFile()) continue;

          try {
            const stat = statSync(fullPath);

            // Remove stale lock files (older than 5 minutes)
            if (entry.name.endsWith('.lock') && (now - stat.mtimeMs > 5 * 60 * 1000)) {
              unlinkSync(fullPath);
              removed++;
              continue;
            }

            // Remove temporary files
            if (entry.name.includes('.coder-tmp-') && (now - stat.mtimeMs > 60 * 1000)) {
              unlinkSync(fullPath);
              removed++;
              continue;
            }

            // Remove files older than maxAge
            if (now - stat.mtimeMs > maxAgeMs) {
              unlinkSync(fullPath);
              removed++;
            }
          } catch {
            // File might have been removed concurrently
          }
        }
      } catch {
        // Directory might have been removed
      }
    };

    cleanDir(this.baseDir);
    return removed;
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Validate filename to prevent path traversal attacks.
   */
  private validateFilename(filename: string): void {
    if (!filename || typeof filename !== 'string') {
      throw new Error('Filename must be a non-empty string');
    }
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new Error(`Invalid filename: "${filename}". Path traversal not allowed.`);
    }
    if (filename.startsWith('.lock') || filename.endsWith('.lock')) {
      throw new Error(`Reserved filename pattern: "${filename}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: Scratchpad | null = null;

/**
 * Get the process-wide Scratchpad singleton.
 * Creates it with the default ~/.coder/scratchpad/ path on first call.
 */
export function getScratchpad(): Scratchpad {
  if (!_instance) {
    _instance = new Scratchpad();
  }
  return _instance;
}

/**
 * Replace the Scratchpad singleton (for testing).
 */
export function setScratchpad(sp: Scratchpad): void {
  _instance = sp;
}
