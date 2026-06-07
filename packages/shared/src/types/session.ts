/**
 * Session types — lifecycle management for agent conversations.
 *
 * Sessions support resume, fork, rewind, and continue operations.
 * Each session tracks its ID, state, message history, costs, and metadata.
 */

import type { Message } from './message.js';

// ---------------------------------------------------------------------------
// Session State Machine
// ---------------------------------------------------------------------------

export type SessionStatus = 'active' | 'paused' | 'completed' | 'error' | 'archived';

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface Session {
  id: string;
  /** User-facing label (derived from first user message) */
  title: string;
  status: SessionStatus;
  /** Messages in chronological order (user ↔ assistant ↔ system) */
  messages: Message[];
  /** Monotonically increasing turn counter */
  turnCount: number;
  /** Total cost in USD */
  totalCost: number;
  /** Creator information */
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  /** Working directory for this session */
  cwd: string;
  /** Git commit hash when the session started (for checkpoint rollback) */
  baseCommit?: string;
  /** Parent session ID (for forked sessions) */
  parentSessionId?: string;
  /** The model used for this session */
  model: string;
  /** The provider used (anthropic, openai, etc.) */
  provider: string;
  /** Cumulative token usage across all turns */
  tokenUsage: TokenUsageSummary;
  /** Metadata for UI display */
  metadata: SessionMetadata;
}

// ---------------------------------------------------------------------------
// Session State (lightweight runtime view)
// ---------------------------------------------------------------------------

export interface SessionState {
  sessionId: string;
  status: SessionStatus;
  turnCount: number;
  messageCount: number;
  totalCost: number;
  currentTokenUsage: number;
  contextBudget: number;
  /** Ratio of current tokens / context budget (0–1) */
  contextPressure: number;
  isCompactNeeded: boolean;
  activeChildAgents: ChildAgentState[];
}

export interface ChildAgentState {
  agentId: string;
  name: string;
  status: 'running' | 'completed' | 'failed' | 'killed';
  spawnedAt: Date;
  completedAt?: Date;
}

// ---------------------------------------------------------------------------
// Token Usage Summary
// ---------------------------------------------------------------------------

export interface TokenUsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
}

// ---------------------------------------------------------------------------
// Session Metadata
// ---------------------------------------------------------------------------

export interface SessionMetadata {
  /** Git branch at session start */
  branch?: string;
  /** Files modified during the session */
  filesModified: string[];
  /** Tools used during the session */
  toolsUsed: string[];
  /** Tags for categorization */
  tags: string[];
  /** Custom user notes */
  notes?: string;
}

// ---------------------------------------------------------------------------
// Session Operations
// ---------------------------------------------------------------------------

export type SessionOperation = 'resume' | 'fork' | 'rewind' | 'continue' | 'new';

export interface SessionResumeOptions {
  sessionId: string;
  cwd?: string;
}

export interface SessionForkOptions {
  sessionId: string;
  /** The turn index to fork from (exclusive — includes messages up to this turn) */
  fromTurn?: number;
  cwd?: string;
}

export interface SessionRewindOptions {
  sessionId: string;
  /** Rewind to this turn index (removes messages after this turn) */
  toTurn: number;
}

// ---------------------------------------------------------------------------
// Session Query
// ---------------------------------------------------------------------------

export interface SessionFilter {
  status?: SessionStatus;
  model?: string;
  provider?: string;
  /** Filter sessions created after this date */
  since?: Date;
  /** Full-text search in title and messages */
  search?: string;
  limit?: number;
  offset?: number;
}

export interface SessionSummary {
  id: string;
  title: string;
  status: SessionStatus;
  turnCount: number;
  totalCost: number;
  createdAt: Date;
  updatedAt: Date;
  model: string;
}
