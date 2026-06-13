import { writeFile } from 'fs/promises';
import * as lockfile from 'proper-lockfile';

/**
 * Lock options: retry with exponential backoff so concurrent callers
 * wait for the lock instead of failing immediately.
 * Budget sized for ~10 concurrent callers.
 */
const LOCK_OPTIONS: lockfile.LockOptions = {
  retries: {
    retries: 10,
    minTimeout: 5,
    maxTimeout: 100,
  },
};

/**
 * Ensure a lock file exists at the given path.
 * The lock file must exist before proper-lockfile can lock it.
 * Uses 'wx' flag so only the first caller creates it.
 */
export async function ensureLockFile(lockPath: string): Promise<string> {
  try {
    await writeFile(lockPath, '', { flag: 'wx' });
  } catch {
    // EEXIST — file already exists, which is fine
  }
  return lockPath;
}

/**
 * Acquire an exclusive lock on the given file path.
 * Returns a release function that must be called to unlock.
 */
export async function lock(targetPath: string): Promise<() => Promise<void>> {
  return lockfile.lock(targetPath, LOCK_OPTIONS);
}

/**
 * Check if a file is currently locked.
 */
export async function checkLocked(targetPath: string): Promise<boolean> {
  return lockfile.check(targetPath);
}
