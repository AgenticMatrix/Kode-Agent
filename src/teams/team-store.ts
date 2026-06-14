/**
 * Team store — persistence layer for team configs.
 *
 * Teams are stored at ~/.coder/teams/{team-name}/config.json.
 * Uses proper-lockfile for concurrent access.
 */

import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';

import type { TeamConfig, TeamMember } from './types.js';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const TEAMS_DIR = join(homedir(), '.coder', 'teams');

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unnamed';
}

export function teamDir(teamName: string): string {
  return join(TEAMS_DIR, sanitize(teamName));
}

function configPath(teamName: string): string {
  return join(teamDir(teamName), 'config.json');
}

// ---------------------------------------------------------------------------
// Lock helpers
// ---------------------------------------------------------------------------

const LOCK_OPTIONS: lockfile.LockOptions = {
  retries: { retries: 10, minTimeout: 5, maxTimeout: 100 },
};

/**
 * Ensure a lock file exists before locking it.
 * proper-lockfile requires the file to already exist.
 */
async function ensureLockFile(lockPath: string): Promise<void> {
  try {
    await writeFile(lockPath, '', { flag: 'wx' });
  } catch {
    // File already exists — fine
  }
}

async function withLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(dir, { recursive: true });
  const lockPath = join(dir, '.lock');
  await ensureLockFile(lockPath);
  const release = await lockfile.lock(lockPath, LOCK_OPTIONS);
  try {
    return await fn();
  } finally {
    await release();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function loadTeamConfig(teamName: string): Promise<TeamConfig | null> {
  try {
    const raw = await readFile(configPath(teamName), 'utf-8');
    return JSON.parse(raw) as TeamConfig;
  } catch {
    return null;
  }
}

export async function saveTeamConfig(config: TeamConfig): Promise<void> {
  const dir = teamDir(config.name);
  await withLock(dir, async () => {
    await writeFile(configPath(config.name), JSON.stringify(config, null, 2), 'utf-8');
  });
}

export async function addTeamMember(
  teamName: string,
  member: TeamMember,
): Promise<TeamConfig> {
  const dir = teamDir(teamName);

  return withLock(dir, async () => {
    const config = await loadTeamConfig(teamName);
    if (!config) {
      throw new Error(`Team '${teamName}' not found`);
    }
    config.members.push(member);
    await writeFile(configPath(teamName), JSON.stringify(config, null, 2), 'utf-8');
    return config;
  });
}

export async function updateTeamMember(
  teamName: string,
  agentId: string,
  patch: Partial<TeamMember>,
): Promise<TeamConfig | null> {
  const dir = teamDir(teamName);

  return withLock(dir, async () => {
    const config = await loadTeamConfig(teamName);
    if (!config) return null;

    const member = config.members.find(m => m.agentId === agentId);
    if (!member) return null;

    Object.assign(member, patch);
    await writeFile(configPath(teamName), JSON.stringify(config, null, 2), 'utf-8');
    return config;
  });
}

export async function listTeams(): Promise<string[]> {
  try {
    const entries = await readdir(TEAMS_DIR, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}

export async function deleteTeam(teamName: string): Promise<void> {
  const dir = teamDir(teamName);
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Already gone — fine
  }
}

/** Remove all team configs — called on session start to clear stale state. */
export async function resetAllTeams(): Promise<void> {
  const names = await listTeams();
  await Promise.all(names.map(n => deleteTeam(n)));
}

export { sanitize as sanitizeTeamName };
