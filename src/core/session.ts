/**
 * SessionManager — Session lifecycle management
 *
 * Manages session creation, resume, fork, rewind, and persistence.
 * Sessions are stored as JSON files in ~/.ink-chat-tui/sessions/.
 *
 * Session management for persisting agent conversation state.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type {
  Session,
  SessionFilter,
  SessionSummary,
  TokenUsageSummary,
} from './types.js';
import type { Message } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSIONS_DIR = join(homedir(), '.ink-chat-tui', 'sessions');

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

export class SessionManager {
  private activeSession: Session | null = null;
  private sessions: Map<string, Session> = new Map();

  constructor() {
    if (!existsSync(SESSIONS_DIR)) {
      mkdirSync(SESSIONS_DIR, { recursive: true });
    }
  }

  /**
   * Create a new session.
   */
  create(options: {
    title?: string;
    cwd?: string;
    model?: string;
    provider?: string;
    parentSessionId?: string;
    baseCommit?: string;
  }): Session {
    const id = randomUUID();
    const now = new Date();
    const session: Session = {
      id,
      title: options.title ?? `Session ${id.slice(0, 8)}`,
      status: 'active',
      messages: [],
      turnCount: 0,
      totalCost: 0,
      createdAt: now,
      updatedAt: now,
      cwd: options.cwd ?? process.cwd(),
      model: options.model ?? 'deepseek-v4-pro',
      provider: options.provider ?? 'anthropic',
      parentSessionId: options.parentSessionId,
      baseCommit: options.baseCommit,
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalTokens: 0,
      },
      metadata: {
        filesModified: [],
        toolsUsed: [],
        tags: [],
      },
    };

    this.sessions.set(id, session);
    this.activeSession = session;
    this.saveSession(session);

    return session;
  }

  /**
   * Get the active session or throw.
   */
  getActive(): Session {
    if (!this.activeSession) {
      throw new Error('No active session. Call create() or resume() first.');
    }
    return this.activeSession;
  }

  /**
   * Get a session by ID.
   */
  get(id: string): Session | undefined {
    // Check cache first
    const cached = this.sessions.get(id);
    if (cached) return cached;

    // Try loading from disk
    return this.loadSession(id);
  }

  /**
   * Resume a session from disk.
   */
  resume(sessionId: string): Session {
    const session = this.loadSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.status = 'active';
    session.updatedAt = new Date();

    this.sessions.set(sessionId, session);
    this.activeSession = session;
    this.saveSession(session);

    return session;
  }

  /**
   * Fork a session — create a new session from the parent's messages up to a turn.
   */
  fork(options: { sessionId: string; fromTurn?: number; cwd?: string }): Session {
    const parent = this.get(options.sessionId);
    if (!parent) {
      throw new Error(`Parent session not found: ${options.sessionId}`);
    }

    const messages = options.fromTurn
      ? parent.messages.slice(0, options.fromTurn)
      : [...parent.messages];

    return this.create({
      title: `${parent.title} (fork)`,
      cwd: options.cwd ?? parent.cwd,
      model: parent.model,
      provider: parent.provider,
      parentSessionId: parent.id,
      baseCommit: parent.baseCommit,
    });
  }

  /**
   * Rewind a session to a specific turn.
   */
  rewind(sessionId: string, toTurn: number): Session {
    const session = this.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Calculate which messages to keep
    let turnCount = 0;
    const keptMessages: Message[] = [];

    for (const msg of session.messages) {
      keptMessages.push(msg);
      if (msg.role === 'assistant') {
        turnCount++;
      }
      if (turnCount >= toTurn) break;
    }

    session.messages = keptMessages;
    session.turnCount = toTurn;
    session.updatedAt = new Date();

    this.saveSession(session);
    return session;
  }

  /**
   * Add a message to the active session.
   */
  addMessage(message: Message): void {
    const session = this.getActive();
    session.messages.push(message);
    session.updatedAt = new Date();

    if (message.role === 'assistant') {
      session.turnCount++;
    }

    // Periodically save (every 5 messages)
    if (session.messages.length % 5 === 0) {
      this.saveSession(session);
    }
  }

  /**
   * Update token usage for the active session.
   */
  updateUsage(usage: Partial<TokenUsageSummary>): void {
    const session = this.getActive();
    if (usage.inputTokens) session.tokenUsage.inputTokens += usage.inputTokens;
    if (usage.outputTokens) session.tokenUsage.outputTokens += usage.outputTokens;
    if (usage.cacheCreationInputTokens) session.tokenUsage.cacheCreationInputTokens = (session.tokenUsage.cacheCreationInputTokens ?? 0) + usage.cacheCreationInputTokens;
    if (usage.cacheReadInputTokens) session.tokenUsage.cacheReadInputTokens = (session.tokenUsage.cacheReadInputTokens ?? 0) + usage.cacheReadInputTokens;
    session.tokenUsage.totalTokens =
      session.tokenUsage.inputTokens +
      session.tokenUsage.outputTokens;
  }

  /**
   * Add cost to the active session.
   */
  addCost(cost: number): void {
    const session = this.getActive();
    session.totalCost += cost;
  }

  /**
   * Add a file to the modified-files list.
   */
  trackModifiedFile(filePath: string): void {
    const session = this.getActive();
    if (!session.metadata.filesModified!.includes(filePath)) {
      session.metadata.filesModified!.push(filePath);
    }
  }

  /**
   * Track a tool that was used.
   */
  trackTool(toolName: string): void {
    const session = this.getActive();
    if (!session.metadata.toolsUsed!.includes(toolName)) {
      session.metadata.toolsUsed!.push(toolName);
    }
  }

  /**
   * Complete the active session.
   */
  complete(): void {
    const session = this.getActive();
    session.status = 'completed';
    session.completedAt = new Date();
    session.updatedAt = new Date();
    this.saveSession(session);
    this.activeSession = null;
  }

  /**
   * Pause the active session.
   */
  pause(): void {
    const session = this.getActive();
    session.status = 'paused';
    session.updatedAt = new Date();
    this.saveSession(session);
    this.activeSession = null;
  }

  /**
   * Mark the active session as error.
   */
  error(): void {
    const session = this.getActive();
    session.status = 'error';
    session.updatedAt = new Date();
    this.saveSession(session);
  }

  /**
   * Save the session to disk.
   */
  saveSession(session: Session): void {
    const dir = join(SESSIONS_DIR, session.id);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const path = join(dir, 'session.json');
    writeFileSync(path, JSON.stringify(session, null, 2), 'utf-8');
  }

  /**
   * List sessions matching a filter.
   */
  list(filter?: SessionFilter): SessionSummary[] {
    const summaries: SessionSummary[] = [];

    let entries: string[];
    try {
      entries = readdirSync(SESSIONS_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return [];
    }

    for (const id of entries) {
      const session = this.loadSession(id);
      if (!session) continue;

      // Apply filters
      if (filter?.status && session.status !== filter.status) continue;
      if (filter?.model && session.model !== filter.model) continue;
      if (filter?.provider && session.provider !== filter.provider) continue;
      if (filter?.since && new Date(session.createdAt) < filter.since) continue;

      summaries.push({
        id: session.id,
        title: session.title,
        status: session.status,
        turnCount: session.turnCount,
        totalCost: session.totalCost,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        model: session.model,
      });
    }

    // Sort by most recently updated
    summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    if (filter?.limit) {
      return summaries.slice(filter.offset ?? 0, (filter.offset ?? 0) + filter.limit);
    }
    return summaries;
  }

  /**
   * Continue the most recently updated session.
   *
   * Finds the latest session by updatedAt and resumes it.
   * Throws if no sessions exist on disk.
   */
  continueLatest(): Session {
    const sessions = this.list({ limit: 1 });
    if (sessions.length === 0) {
      throw new Error('No sessions found. Call create() first.');
    }
    return this.resume(sessions[0]!.id);
  }

  /**
   * List all sessions (convenience wrapper around list()).
   *
   * @param limit — Maximum number of sessions to return (default: 50)
   * @returns SessionSummary[] sorted by most recently updated
   */
  listSessions(limit?: number): SessionSummary[] {
    return this.list({ limit: limit ?? 50 });
  }

  /**
   * Delete a session.
   */
  delete(sessionId: string): boolean {
    const dir = join(SESSIONS_DIR, sessionId);
    const sessionPath = join(dir, 'session.json');

    if (!existsSync(sessionPath)) return false;

    try {
      // Delete session files recursively
      const files = readdirSync(dir);
      for (const file of files) {
        unlinkSync(join(dir, file));
      }
      // Remove the directory (may have subdirs like tasks/)
      try { unlinkSync(dir); } catch { /* not empty, leave subdirs */ }

      this.sessions.delete(sessionId);
      if (this.activeSession?.id === sessionId) {
        this.activeSession = null;
      }
      return true;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private loadSession(id: string): Session | undefined {
    const path = join(SESSIONS_DIR, id, 'session.json');
    if (!existsSync(path)) return undefined;

    try {
      const raw = readFileSync(path, 'utf-8');
      const data = JSON.parse(raw);

      // Convert date strings back to Date objects
      return {
        ...data,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
        completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
      };
    } catch {
      return undefined;
    }
  }
}
