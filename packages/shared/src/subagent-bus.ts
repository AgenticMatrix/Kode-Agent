/**
 * subagent-bus.ts — Central coordinator for sub-agent lifecycle
 *
 * Tracks running sub-agents (spawned via Agent tool), drains completed
 * outputs, and injects <task-notification> XML into the Agent Loop's
 * message stream so the LLM sees when background agents finish.
 *
 * Supports two spawn paths:
 *  1. Internal engine creation: spawn(parentSessionId, config) —
 *     requires initialize() with a runAgent callback. The callback
 *     receives agentId + config and is responsible for creating &
 *     running a restricted Agent Loop in the background.
 *  2. External registration: registerExternal(opts) — registers an
 *     already-running agent for tracking.
 *
 * Architecture reference: ARCHITECTURE.md §4.3 (Sub-Agent System)
 */

import { randomUUID } from 'node:crypto';
import type { Message, UserMessage } from './types/message.js';
import type { WorkerConfig } from './agent-teams.js';

// AbortController is a global in Node.js >=15 (via @types/node)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SubagentStatus = 'spawned' | 'running' | 'completed' | 'errored' | 'aborted';

export interface SubagentEntry {
  /** Unique agent identifier (matches Agent tool spawn ID) */
  agentId: string;
  /** Task description assigned to this sub-agent */
  description: string;
  /** Sub-agent type (Explore, general-purpose, Plan, etc.) */
  subagentType?: string;
  /** Current status */
  status: SubagentStatus;
  /** Accumulated transcript lines (pushed by parent on receipt) */
  transcript: string[];
  /** Structured messages (full Message history for getTranscript()) */
  messages: unknown[];
  /** Abort controller to stop the sub-agent mid-execution */
  controller: AbortController;
  /** Timestamp when the agent was spawned */
  spawnTime: number;
  /** The turn number in the parent loop when this agent was spawned */
  parentTurn: number;
  /** Completion timestamp (set when status transitions to terminal) */
  completedAt?: number;
  /** Error message if errored */
  error?: string;
  /** Summary result text (extracted from final assistant message) */
  result?: string;
  /** Turn count for this sub-agent */
  turnCount: number;
  /** Message queue — pending messages from parent (AgentMessage tool) */
  messageQueue: UserMessage[];
  /** External promise that resolves when the agent finishes */
  donePromise: Promise<void>;
  /** Resolver for donePromise */
  _resolveDone: () => void;
  /** Mutex to avoid double-completion */
  _settled: boolean;
}

export interface SubagentSpawnOptions {
  agentId: string;
  description: string;
  subagentType?: string;
  controller: AbortController;
  donePromise: Promise<void>;
}

/** Config for internal spawn — passed to the runAgent callback */
export interface SubagentSpawnConfig {
  description: string;
  prompt: string;
  subagentType?: string;
  maxTurns?: number;
  /**
   * Per-spawn Worker configuration for Agent Teams protocol.
   * When set, overrides the default workerConfig from CreateRunAgentOptions.
   * Contains role and allowedTools for tool restriction on this specific spawn.
   */
  workerConfig?: WorkerConfig;
}

/**
 * Callback invoked by spawn() to run a sub-agent in the background.
 *
 * The callback receives the agentId, parent session ID, and spawn config.
 * It is responsible for:
 *  1. Creating a restricted engine (no Agent tools)
 *  2. Running the agent loop
 *  3. Updating the entry's transcript, messages, and result
 *  4. Resolving/rejecting the donePromise on completion
 */
export type RunAgentCallback = (
  agentId: string,
  entry: SubagentEntry,
  parentSessionId: string,
  config: SubagentSpawnConfig,
) => Promise<void>;

/** Configuration for internal spawn — passed to the runAgent callback */
export interface SubagentSpawnConfig {
  description: string;
  prompt: string;
  subagentType?: string;
  maxTurns?: number;
  /**
   * Per-spawn Worker configuration for Agent Teams protocol.
   * When set, overrides the default workerConfig from CreateRunAgentOptions.
   * Contains role and allowedTools for tool restriction on this specific spawn.
   */
  workerConfig?: WorkerConfig;
}

/** Configuration for fork session — inherits parent context */
export interface ForkSessionConfig {
  /** Short description of the fork task */
  description: string;
  /** The task prompt */
  prompt: string;
  /** Parent's full message history to inherit (optional — callback may obtain from sessionManager) */
  parentMessages?: Message[];
  /** Maximum turns for the forked session (default: 50) */
  maxTurns?: number;
  /** Token budget for the forked session (default: 200K) */
  contextBudget?: number;
}

/**
 * Callback invoked by forkSession() to run a forked agent in the background.
 *
 * Unlike spawn(), a fork inherits the parent's full message context.
 * The callback receives agentId, parent session ID, and fork config.
 */
export type RunForkAgentCallback = (
  agentId: string,
  entry: SubagentEntry,
  parentSessionId: string,
  config: ForkSessionConfig,
) => Promise<void>;

/** Configuration for initializing the bus with engine-runner dependencies */
export interface SubagentBusConfig {
  maxConcurrent?: number;
  maxTranscriptLines?: number;
  /** Required for spawn(parentSessionId, config) — creates & runs agent loop */
  runAgent?: RunAgentCallback;
  /** Required for forkSession(parentSessionId, config) — creates forked agent loop */
  runForkAgent?: RunForkAgentCallback;
  /**
   * Maximum time in ms a sub-agent can run before being auto-terminated.
   * When exceeded, the agent is aborted and settled as 'errored' with a
   * timeout error message. Set to 0 (or omit) to disable timeout.
   * Default: 0 (disabled).
   */
  maxTimeoutMs?: number;
  /**
   * Called when a sub-agent completes (success, error, or abort).
   * Use this to inject <task-notification> XML into the parent Agent's
   * message stream for real-time awareness of background task completion.
   */
  onAgentCompleted?: (completed: CompletedSubagent) => void;
}

export interface CompletedSubagent {
  agentId: string;
  description: string;
  status: 'completed' | 'errored' | 'aborted';
  transcript: string[];
  messages: unknown[];
  error?: string;
  result?: string;
  turnCount: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Notification XML format
// ---------------------------------------------------------------------------

/**
 * Render a <task-notification> XML element describing a completed agent.
 * The Agent Loop injects this into the user-message stream so the LLM
 * is aware that a background worker finished.
 */
export function formatTaskNotification(completed: CompletedSubagent): string {
  const status = completed.status === 'completed' ? 'completed' : 'failed';
  const transcriptPreview = completed.transcript.slice(0, 20).join('\n');
  const snippet =
    transcriptPreview.length > 2000
      ? transcriptPreview.slice(0, 2000) + '\n... (truncated)'
      : transcriptPreview;

  let xml = `<task-notification agent_id="${completed.agentId}" status="${status}" duration_ms="${completed.durationMs}">`;
  xml += `\n<description>${escapeXml(completed.description)}</description>`;
  if (completed.error) {
    xml += `\n<error>${escapeXml(completed.error)}</error>`;
  }
  if (completed.result) {
    const resultSnippet = completed.result.length > 500
      ? completed.result.slice(0, 500) + '...'
      : completed.result;
    xml += `\n<result>${escapeXml(resultSnippet)}</result>`;
  }
  xml += `\n<transcript>\n${escapeXml(snippet)}\n</transcript>`;
  xml += `\n</task-notification>`;
  return xml;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// SubagentBus
// ---------------------------------------------------------------------------

export class SubagentBus {
  /** All agents tracked by this bus (running + recently completed) */
  private agents = new Map<string, SubagentEntry>();
  /** Recently completed agents waiting to be drained */
  private completedQueue: CompletedSubagent[] = [];
  /** Max transcript lines to keep per agent */
  private maxTranscriptLines: number;
  /** Max concurrent agents allowed */
  maxConcurrent: number;
  /**
   * Maximum time in ms a sub-agent can run before being auto-terminated.
   * 0 means no timeout. Default: 0.
   */
  maxTimeoutMs: number;
  /** Active timeout timers (keyed by agentId) for auto-termination */
  private timeoutTimers = new Map<string, NodeJS.Timeout>();
  /** Engine-runner configuration */
  private config: SubagentBusConfig = {};

  constructor(options?: { maxTranscriptLines?: number; maxConcurrent?: number; maxTimeoutMs?: number }) {
    this.maxTranscriptLines = options?.maxTranscriptLines ?? 5000;
    this.maxConcurrent = options?.maxConcurrent ?? 5;
    this.maxTimeoutMs = options?.maxTimeoutMs ?? 0;
  }

  /**
   * Initialize with config including optional runAgent callback.
   * Required before calling spawn(parentSessionId, config).
   * Safe to call multiple times — subsequent calls merge/update.
   */
  initialize(config: SubagentBusConfig): void {
    this.config = { ...this.config, ...config };
    if (config.maxConcurrent !== undefined) {
      this.maxConcurrent = config.maxConcurrent;
    }
    if (config.maxTranscriptLines !== undefined) {
      this.maxTranscriptLines = config.maxTranscriptLines;
    }
    if (config.maxTimeoutMs !== undefined) {
      this.maxTimeoutMs = config.maxTimeoutMs;
    }
  }

  // ── Spawn (internal engine creation) ─────────────────────────────

  /**
   * Spawn a sub-agent by invoking the runAgent callback in the background.
   * **Non-blocking** — returns the agentId immediately.
   *
   * Requires initialize() to have been called with a runAgent callback.
   *
   * @returns agentId for tracking via get() / cancel() / drainCompleted().
   * @throws If concurrency limit is exceeded or runAgent not configured.
   */
  spawn(parentSessionId: string, spawnConfig: SubagentSpawnConfig): string {
    if (!this.config.runAgent) {
      throw new Error(
        'SubagentBus not initialized for engine creation. ' +
        'Call bus.initialize({ runAgent }) with an engine-runner callback.',
      );
    }

    if (this.runningCount >= this.maxConcurrent) {
      throw new Error(
        `Maximum concurrent sub-agents (${this.maxConcurrent}) reached. ` +
        `Wait for running agents to complete or cancel them before spawning more.`,
      );
    }

    const agentId = randomUUID();
    const controller = new AbortController();

    let resolveDone!: () => void;
    const donePromise = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    const entry: SubagentEntry = {
      agentId,
      description: spawnConfig.description,
      subagentType: spawnConfig.subagentType,
      status: 'spawned',
      transcript: [],
      messages: [],
      controller,
      spawnTime: Date.now(),
      parentTurn: -1,
      donePromise,
      _resolveDone: resolveDone,
      _settled: false,
      turnCount: 0,
      messageQueue: [],
    };

    this.agents.set(agentId, entry);

    // Schedule auto-termination timeout if configured
    this.scheduleTimeout(entry);

    // Fire-and-forget — runAgent callback handles engine creation & lifecycle
    const runAgent = this.config.runAgent;
    runAgent(agentId, entry, parentSessionId, spawnConfig).catch((err: unknown) => {
      if (!entry._settled) {
        entry.error = err instanceof Error ? err.message : String(err);
        this.settle(entry, 'errored');
      }
    });

    return agentId;
  }

  // ── Fork Session (context inheritance) ────────────────────────────

  /**
   * Fork a sub-agent that inherits the parent's full message context.
   * **Non-blocking** — returns the agentId immediately.
   *
   * Unlike spawn(), a fork:
   *  - Inherits the parent's message history (not just a prompt)
   *  - Uses the parent's tool registry (no tool restrictions)
   *  - Has its own context window (200K token budget by default)
   *  - Returns a summary text (not full message transcript)
   *
   * Requires initialize() to have been called with a runForkAgent callback.
   *
   * @returns agentId for tracking.
   * @throws If concurrency limit is exceeded or runForkAgent not configured.
   */
  forkSession(parentSessionId: string, config: ForkSessionConfig): string {
    if (!this.config.runForkAgent) {
      throw new Error(
        'SubagentBus not initialized for fork sessions. ' +
        'Call bus.initialize({ runForkAgent }) with a fork-engine-runner callback.',
      );
    }

    if (this.runningCount >= this.maxConcurrent) {
      throw new Error(
        `Maximum concurrent sub-agents (${this.maxConcurrent}) reached. ` +
        `Wait for running agents to complete before forking more.`,
      );
    }

    const agentId = randomUUID();
    const controller = new AbortController();

    let resolveDone!: () => void;
    const donePromise = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    const entry: SubagentEntry = {
      agentId,
      description: `fork: ${config.description}`,
      subagentType: 'Fork',
      status: 'spawned',
      transcript: [],
      messages: [],
      controller,
      spawnTime: Date.now(),
      parentTurn: -1,
      donePromise,
      _resolveDone: resolveDone,
      _settled: false,
      turnCount: 0,
      messageQueue: [],
    };

    this.agents.set(agentId, entry);

    // Schedule auto-termination timeout if configured
    this.scheduleTimeout(entry);

    // Fire-and-forget — runForkAgent handles engine creation & lifecycle
    const runForkAgent = this.config.runForkAgent;
    runForkAgent(agentId, entry, parentSessionId, config).catch((err: unknown) => {
      if (!entry._settled) {
        entry.error = err instanceof Error ? err.message : String(err);
        this.settle(entry, 'errored');
      }
    });

    return agentId;
  }

  // ── Spawn (external registration) ────────────────────────────────

  /**
   * Register an externally-managed sub-agent for tracking.
   * Returns false if the concurrency limit is reached.
   *
   * Use this when the caller creates and manages the agent loop
   * (e.g. an AgentSpawn tool that delegates to a separate process).
   */
  registerExternal(opts: SubagentSpawnOptions): boolean {
    if (this.runningCount >= this.maxConcurrent) {
      return false;
    }

    let resolveDone!: () => void;
    const donePromise = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    const entry: SubagentEntry = {
      agentId: opts.agentId,
      description: opts.description,
      subagentType: opts.subagentType,
      status: 'running',
      transcript: [],
      messages: [],
      controller: opts.controller,
      spawnTime: Date.now(),
      parentTurn: -1,
      donePromise,
      _resolveDone: resolveDone,
      _settled: false,
      turnCount: 0,
      messageQueue: [],
    };

    // Wire the external done promise to settle this entry
    opts.donePromise
      .then(() => {
        this.settle(entry, 'completed');
      })
      .catch((err: unknown) => {
        entry.error = err instanceof Error ? err.message : String(err);
        this.settle(entry, 'errored');
      });

    this.agents.set(opts.agentId, entry);

    // Schedule auto-termination timeout if configured
    this.scheduleTimeout(entry);

    return true;
  }

  // ── Settle ───────────────────────────────────────────────────────

  /**
   * Set up an auto-termination timeout for a sub-agent entry.
   * When the timeout fires, the agent is aborted and settled as 'errored'.
   */
  private scheduleTimeout(entry: SubagentEntry): void {
    if (this.maxTimeoutMs <= 0) return;

    const timer = setTimeout(() => {
      if (!entry._settled) {
        entry.error = `Agent timed out after ${this.maxTimeoutMs}ms (max timeout exceeded)`;
        entry.controller.abort();
        this.settle(entry, 'errored');
      }
    }, this.maxTimeoutMs);

    this.timeoutTimers.set(entry.agentId, timer);
  }

  private settle(entry: SubagentEntry, status: 'completed' | 'errored' | 'aborted'): void {
    if (entry._settled) return;
    entry._settled = true;
    entry.status = status;
    entry.completedAt = Date.now();
    entry._resolveDone();

    // Clear the timeout timer if one was scheduled
    const timer = this.timeoutTimers.get(entry.agentId);
    if (timer) {
      clearTimeout(timer);
      this.timeoutTimers.delete(entry.agentId);
    }

    const completed: CompletedSubagent = {
      agentId: entry.agentId,
      description: entry.description,
      status,
      transcript: [...entry.transcript],
      messages: [...entry.messages],
      error: entry.error,
      result: entry.result,
      turnCount: entry.turnCount,
      durationMs: entry.completedAt - entry.spawnTime,
    };

    this.completedQueue.push(completed);

    // Auto-notification: fire the callback so the parent Agent can
    // inject <task-notification> XML into the message stream immediately.
    if (this.config.onAgentCompleted) {
      try {
        this.config.onAgentCompleted(completed);
      } catch {
        // Callback errors must not disrupt agent settlement
      }
    }
  }

  // ── Drain ────────────────────────────────────────────────────────

  /**
   * Return all sub-agents that have completed since the last drain.
   * Clears the completed queue and removes entries from tracking.
   */
  drainCompleted(): CompletedSubagent[] {
    const drained = this.completedQueue.splice(0);

    for (const c of drained) {
      this.agents.delete(c.agentId);
    }

    return drained;
  }

  /**
   * Check whether any completed agents are waiting to be drained.
   */
  hasCompleted(): boolean {
    return this.completedQueue.length > 0;
  }

  // ── Cancel / Abort ───────────────────────────────────────────────

  /**
   * Cancel a running sub-agent by its ID.
   * Calls AbortController.abort() and marks the entry as 'aborted'.
   */
  cancel(agentId: string): boolean {
    return this.abort(agentId);
  }

  /**
   * Abort a running sub-agent by its ID. Returns true if the agent
   * was found and aborted.
   */
  abort(agentId: string): boolean {
    const entry = this.agents.get(agentId);
    if (!entry || entry.status === 'completed' || entry.status === 'errored' || entry.status === 'aborted') {
      return false;
    }
    entry.controller.abort();
    this.settle(entry, 'aborted');
    return true;
  }

  /**
   * Cancel all running sub-agents.
   */
  cancelAll(): number {
    return this.abortAll();
  }

  /**
   * Abort all running sub-agents.
   */
  abortAll(): number {
    let count = 0;
    for (const [, entry] of this.agents) {
      if (entry.status === 'spawned' || entry.status === 'running') {
        entry.controller.abort();
        this.settle(entry, 'aborted');
        count++;
      }
    }
    return count;
  }

  // ── Read Transcript (string lines) ───────────────────────────────

  /**
   * Read transcript lines from a sub-agent (running or recently completed).
   * Supports pagination via offset/limit. Returns null if the agent is unknown.
   */
  readTranscript(
    agentId: string,
    offset: number,
    limit: number,
  ): { lines: string[]; totalLines: number; status: SubagentStatus } | null {
    const entry = this.agents.get(agentId);
    if (!entry) return null;

    const start = Math.max(0, offset);
    const end = Math.min(entry.transcript.length, start + limit);
    return {
      lines: entry.transcript.slice(start, end),
      totalLines: entry.transcript.length,
      status: entry.status,
    };
  }

  // ── Get Transcript (structured messages) ─────────────────────────

  /**
   * Get the full structured message transcript for a sub-agent.
   * Returns undefined if the agent ID is unknown or already drained.
   *
   * Messages are stored as unknown[] in shared (to avoid circular deps).
   * Cast to Message[] at the call site.
   */
  getTranscript(agentId: string): unknown[] | undefined {
    return this.agents.get(agentId)?.messages;
  }

  // ── Append Transcript ────────────────────────────────────────────

  /**
   * Append a line to a running sub-agent's transcript.
   */
  appendToTranscript(agentId: string, line: string): void {
    const entry = this.agents.get(agentId);
    if (!entry) return;

    entry.transcript.push(line);
    if (entry.transcript.length > this.maxTranscriptLines) {
      entry.transcript = entry.transcript.slice(-this.maxTranscriptLines);
    }
  }

  /**
   * Append a structured message to a sub-agent's message history.
   */
  appendMessage(agentId: string, message: unknown): void {
    const entry = this.agents.get(agentId);
    if (!entry) return;
    entry.messages.push(message);
  }

  // ── Mutation helpers (for runAgent callbacks) ────────────────────

  /**
   * Set the result text on an entry. Used by runAgent callbacks.
   */
  setResult(agentId: string, result: string): void {
    const entry = this.agents.get(agentId);
    if (entry) entry.result = result;
  }

  /**
   * Set error on an entry and settle as 'errored'. Used by runAgent callbacks.
   */
  setError(agentId: string, error: string): void {
    const entry = this.agents.get(agentId);
    if (entry && !entry._settled) {
      entry.error = error;
      this.settle(entry, 'errored');
    }
  }

  /**
   * Mark an entry as completed. Used by runAgent callbacks.
   */
  complete(agentId: string): void {
    const entry = this.agents.get(agentId);
    if (entry && !entry._settled) {
      this.settle(entry, 'completed');
    }
  }

  /**
   * Increment the turn count for an entry. Used by runAgent callbacks.
   */
  incrementTurn(agentId: string): void {
    const entry = this.agents.get(agentId);
    if (entry) entry.turnCount++;
  }

  // ── Message Queue (AgentMessage async delivery) ──────────────────

  /**
   * Send a message to a running Worker's message queue.
   *
   * The message is appended to the target Worker's messageQueue.
   * The Worker's Agent Loop checks the queue at the start of each turn
   * (via drainMessageQueue) and injects queued messages into its
   * messages array.
   *
   * If the Worker is not running, the message is appended to its
   * transcript as a fallback (visible via AgentRead).
   *
   * @returns true if the message was queued, false if the Worker was
   *          not found or not running (transcript fallback applied).
   */
  sendMessage(agentId: string, message: UserMessage): boolean {
    const entry = this.agents.get(agentId);
    if (!entry) return false;

    if (entry.status === 'spawned' || entry.status === 'running') {
      entry.messageQueue.push(message);
      return true;
    }

    // Fallback: Worker isn't running — append to transcript
    const preview = typeof message.content === 'string'
      ? message.content.slice(0, 200)
      : '[structured message]';
    entry.transcript.push(`[Parent → Worker (queued after completion)] ${preview}`);
    return false;
  }

  /**
   * Drain all pending messages from a Worker's queue.
   * Called by the Worker's Agent Loop at the start of each turn.
   *
   * @returns Array of pending UserMessages (empty if none queued).
   */
  drainMessageQueue(agentId: string): UserMessage[] {
    const entry = this.agents.get(agentId);
    if (!entry || entry.messageQueue.length === 0) return [];
    return entry.messageQueue.splice(0);
  }

  // ── Query ────────────────────────────────────────────────────────

  get(agentId: string): SubagentEntry | undefined {
    return this.agents.get(agentId);
  }

  get runningCount(): number {
    let count = 0;
    for (const [, entry] of this.agents) {
      if (entry.status === 'spawned' || entry.status === 'running') count++;
    }
    return count;
  }

  getRunningIds(): string[] {
    const ids: string[] = [];
    for (const [id, entry] of this.agents) {
      if (entry.status === 'spawned' || entry.status === 'running') ids.push(id);
    }
    return ids;
  }

  /**
   * List all tracked agents (running + completed).
   */
  listAll(): Array<{ agentId: string; description: string; status: SubagentStatus }> {
    const result: Array<{ agentId: string; description: string; status: SubagentStatus }> = [];
    for (const [id, entry] of this.agents) {
      result.push({ agentId: id, description: entry.description, status: entry.status });
    }
    return result;
  }

  /**
   * Clean up all state. Called on shutdown.
   */
  destroy(): void {
    // Clear all timeout timers first
    for (const timer of this.timeoutTimers.values()) {
      clearTimeout(timer);
    }
    this.timeoutTimers.clear();
    this.cancelAll();
    this.agents.clear();
    this.completedQueue.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Singleton (shared across the CLI process for tool access)
// ---------------------------------------------------------------------------

let _instance: SubagentBus | null = null;

export function getSubagentBus(): SubagentBus {
  if (!_instance) {
    _instance = new SubagentBus();
  }
  return _instance;
}

export function setSubagentBus(bus: SubagentBus): void {
  _instance = bus;
}

export function resetSubagentBus(): void {
  if (_instance) {
    _instance.destroy();
    _instance = null;
  }
}
