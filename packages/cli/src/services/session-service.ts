/**
 * session-service.ts — CLI session service
 *
 * Wraps SessionManager and CheckpointManager for CLI use cases:
 * - Resume / Continue / Fork from command-line args
 * - Session persistence to ~/.kode/sessions/
 * - Checkpoint integration (auto-create on session start)
 */

import { SessionManager, CheckpointManager } from '@kode/core';
import type { Checkpoint } from '@kode/core';
import type { Session, SessionSummary } from '@kode/shared';

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

let _sessionManager: SessionManager | null = null;
let _checkpointManager: CheckpointManager | null = null;

export function getSessionManager(): SessionManager {
  if (!_sessionManager) {
    _sessionManager = new SessionManager();
  }
  return _sessionManager;
}

export function getCheckpointManager(): CheckpointManager {
  if (!_checkpointManager) {
    _checkpointManager = new CheckpointManager();
  }
  return _checkpointManager;
}

// ---------------------------------------------------------------------------
// Session Operations
// ---------------------------------------------------------------------------

export interface CreateSessionOptions {
  title?: string;
  cwd?: string;
  model?: string;
  provider?: string;
  parentSessionId?: string;
  baseCommit?: string;
}

export async function createSession(options: CreateSessionOptions = {}): Promise<{
  session: Session;
  checkpoint: Checkpoint | null;
}> {
  const sm = getSessionManager();
  const cm = getCheckpointManager();

  const session = sm.create({
    title: options.title,
    cwd: options.cwd ?? process.cwd(),
    model: options.model,
    provider: options.provider,
    parentSessionId: options.parentSessionId,
    baseCommit: options.baseCommit,
  });

  let checkpoint: Checkpoint | null = null;
  try {
    checkpoint = await cm.create({
      sessionId: session.id,
      cwd: session.cwd,
      description: `Initial checkpoint for session ${session.id.slice(0, 8)}`,
    });
  } catch {
    // Non-git directory — checkpoint is optional
  }

  return { session, checkpoint };
}

export async function resumeSession(sessionId: string): Promise<{
  session: Session;
  checkpoint: Checkpoint | null;
}> {
  const sm = getSessionManager();
  const cm = getCheckpointManager();

  const session = sm.resume(sessionId);
  cm.loadFromDisk(sessionId);

  let checkpoint: Checkpoint | null = null;
  try {
    checkpoint = await cm.create({
      sessionId: session.id,
      cwd: session.cwd,
      description: `Resume checkpoint for session ${session.id.slice(0, 8)}`,
    });
  } catch {
    // Non-git directory — checkpoint is optional
  }

  return { session, checkpoint };
}

export async function continueLatestSession(): Promise<{
  session: Session;
  checkpoint: Checkpoint | null;
}> {
  const sm = getSessionManager();

  const sessions = sm.list({ limit: 1 });
  if (sessions.length === 0) {
    throw new Error('No previous sessions found. Start a new session with `kode`.');
  }

  const latest = sessions[0]!;
  if (latest.status === 'completed' || latest.status === 'archived') {
    throw new Error(
      `Latest session "${latest.title}" is already ${latest.status}. Use --resume <id> to force or start a new session.`,
    );
  }

  return resumeSession(latest.id);
}

export async function forkSession(
  sessionId: string,
  fromTurn?: number,
): Promise<{
  session: Session;
  checkpoint: Checkpoint | null;
}> {
  const sm = getSessionManager();

  const session = sm.fork({ sessionId, fromTurn });

  const cm = getCheckpointManager();
  let checkpoint: Checkpoint | null = null;
  try {
    checkpoint = await cm.create({
      sessionId: session.id,
      cwd: session.cwd,
      description: `Fork checkpoint (from ${sessionId.slice(0, 8)}${fromTurn ? ` turn ${fromTurn}` : ''})`,
    });
  } catch {
    // Non-git directory — checkpoint is optional
  }

  return { session, checkpoint };
}

export function listSessions(limit = 10): SessionSummary[] {
  const sm = getSessionManager();
  return sm.list({ limit });
}

export function getSession(sessionId: string): Session | undefined {
  const sm = getSessionManager();
  return sm.get(sessionId);
}

export function deleteSession(sessionId: string): boolean {
  const sm = getSessionManager();
  return sm.delete(sessionId);
}

// ---------------------------------------------------------------------------
// Session Display Helpers
// ---------------------------------------------------------------------------

export function formatSessionSummary(s: SessionSummary, index?: number): string {
  const statusIcon = s.status === 'active'
    ? '●'
    : s.status === 'paused'
      ? '⏸'
      : s.status === 'completed'
        ? '✓'
        : s.status === 'error'
          ? '✗'
          : '📦';

  const date = new Date(s.updatedAt).toLocaleString();
  const cost = s.totalCost > 0 ? ` $${s.totalCost.toFixed(2)}` : '';
  const prefix = index !== undefined ? `${index}. ` : '';

  return `${prefix}${statusIcon} ${s.id.slice(0, 8)}  ${s.title.slice(0, 40)}  ${s.turnCount}t${cost}  ${date}  ${s.model}`;
}

export function formatSessionList(sessions: SessionSummary[]): string {
  if (sessions.length === 0) {
    return 'No sessions found.';
  }

  const lines = sessions.map((s, i) => formatSessionSummary(s, i + 1));
  return lines.join('\n');
}

export function findResumableSession(): SessionSummary | null {
  const sm = getSessionManager();

  const paused = sm.list({ status: 'paused', limit: 1 });
  if (paused.length > 0) return paused[0]!;

  const active = sm.list({ status: 'active', limit: 1 });
  if (active.length > 0) return active[0]!;

  const error = sm.list({ status: 'error', limit: 1 });
  if (error.length > 0) return error[0]!;

  return null;
}
