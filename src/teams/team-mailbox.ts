/**
 * Team mailbox — inter-agent messaging.
 *
 * Each team member gets an inbox file:
 *   ~/.coder/teams/{team-name}/inboxes/{agent-name}.json
 *
 * Messages are appended to the recipient's inbox under a file lock.
 * The coordinator drains unread messages before each turn.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';

import { teamDir } from './team-store.js';
import { sanitizeTeamName } from './team-store.js';
import type { TeamMessage } from './types.js';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function inboxDir(teamName: string): string {
  return join(teamDir(teamName), 'inboxes');
}

function inboxPath(teamName: string, agentName: string): string {
  return join(inboxDir(teamName), `${sanitizeTeamName(agentName)}.json`);
}

function inboxLockPath(teamName: string, agentName: string): string {
  return join(inboxDir(teamName), `${sanitizeTeamName(agentName)}.lock`);
}

// ---------------------------------------------------------------------------
// Lock helper
// ---------------------------------------------------------------------------

async function ensureLockFile(lockPath: string): Promise<void> {
  try {
    await writeFile(lockPath, '', { flag: 'wx' });
  } catch {
    // Already exists — fine
  }
}

async function withInboxLock<T>(
  teamName: string,
  agentName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const dir = inboxDir(teamName);
  await mkdir(dir, { recursive: true });
  const lockPath = inboxLockPath(teamName, agentName);
  await ensureLockFile(lockPath);
  const release = await lockfile.lock(lockPath, {
    retries: { retries: 10, minTimeout: 5, maxTimeout: 100 },
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}

// ---------------------------------------------------------------------------
// Read / write helpers
// ---------------------------------------------------------------------------

async function readInbox(teamName: string, agentName: string): Promise<TeamMessage[]> {
  const path = inboxPath(teamName, agentName);
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as TeamMessage[];
  } catch {
    return [];
  }
}

async function writeInbox(
  teamName: string,
  agentName: string,
  messages: TeamMessage[],
): Promise<void> {
  const dir = inboxDir(teamName);
  await mkdir(dir, { recursive: true });
  await writeFile(inboxPath(teamName, agentName), JSON.stringify(messages, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function sendMessage(
  teamName: string,
  from: string,
  to: string,
  text: string,
): Promise<TeamMessage> {
  const msg: TeamMessage = {
    from,
    to,
    text,
    timestamp: Date.now(),
    read: false,
  };

  await withInboxLock(teamName, to, async () => {
    const messages = await readInbox(teamName, to);
    messages.push(msg);
    await writeInbox(teamName, to, messages);
  });

  return msg;
}

export async function readMessages(
  teamName: string,
  agentName: string,
): Promise<TeamMessage[]> {
  return readInbox(teamName, agentName);
}

export async function drainUnreadMessages(
  teamName: string,
  agentName: string,
): Promise<TeamMessage[]> {
  return withInboxLock(teamName, agentName, async () => {
    const messages = await readInbox(teamName, agentName);
    const unread = messages.filter(m => !m.read);
    if (unread.length > 0) {
      for (const m of unread) {
        m.read = true;
      }
      await writeInbox(teamName, agentName, messages);
    }
    return unread;
  });
}

export async function getUnreadCount(
  teamName: string,
  agentName: string,
): Promise<number> {
  const messages = await readInbox(teamName, agentName);
  return messages.filter(m => !m.read).length;
}
