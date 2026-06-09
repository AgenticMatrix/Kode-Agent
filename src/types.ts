/**
 * Core type definitions for the Unified Agent TUI.
 *
 * ContentBlock-driven message model: each Message contains an array of
 * typed ContentBlocks that drive rendering.  The model supports both
 * CoderAgent (35+ tools).
 */

// ── ContentBlock types ──────────────────────────────────────────────

export interface TextBlock {
  type: 'text';
  content: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  content: string;
  expanded?: boolean;
}

export type ToolUseState = 'pending' | 'executing' | 'done' | 'error';
export type RiskLevel = 'safe' | 'mutation' | 'destructive';
export type PermissionState = 'approved' | 'denied' | 'pending';

export interface ToolUseBlock {
  type: 'tool_use';
  toolName: string;
  toolId: string;
  input: Record<string, unknown>;
  state: ToolUseState;
  duration?: number;
  riskLevel?: RiskLevel;
  permissionState?: PermissionState;
  /** Tool execution result (injected after execution for inline display). */
  result?: {
    content: string;
    isError: boolean;
    metadata?: Record<string, unknown>;
  };
}

export interface ToolResultBlock {
  type: 'tool_result';
  toolId: string;
  toolName: string;
  content: string;
  isError: boolean;
  truncated?: boolean;
  /** Execution duration in milliseconds. */
  duration?: number;
  /** Tool-specific structured metadata from the executor. */
  metadata?: Record<string, unknown>;
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}

export interface TodoUpdateBlock {
  type: 'todo_update';
  todos: TodoItem[];
  oldTodos?: TodoItem[];
}

export interface TurnSummary {
  turnNumber: number;
  toolCount: number;
  subagentCount: number;
  todoUpdates: number;
  duration: number;
  tokenUsage: { input: number; output: number; cache?: number };
  outcome: 'success' | 'error' | 'interrupted' | 'compacted';
}

export interface TurnBoundary {
  type: 'turn_boundary';
  turnId: number;
  summary?: TurnSummary;
}

export type SubagentType = 'explore' | 'plan' | 'general-purpose' | 'verification';
export type SubagentState = 'running' | 'done' | 'error';

export interface SubagentBlock {
  type: 'subagent';
  agentType: SubagentType;
  agentName: string;
  state: SubagentState;
  messageCount?: number;
}

export interface CompactionBoundary {
  type: 'compaction';
  removedCount: number;
  reason: string;
}

export type SpeculationState = 'predicting' | 'used' | 'discarded';

export interface SpeculationBlock {
  type: 'speculation';
  state: SpeculationState;
}

export interface CompletionBoundary {
  type: 'completion';
  stopReason: string;
}

/**
 * All ContentBlock variants.  Each block drives its own renderer.
 * New block types can be added without changing existing renderers.
 */
export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | ToolUseBlock
  | ToolResultBlock
  | TodoUpdateBlock
  | TurnBoundary
  | SubagentBlock
  | CompactionBoundary
  | SpeculationBlock
  | CompletionBoundary;

// ── Message ─────────────────────────────────────────────────────────

export interface Message {
  id: number;
  role: 'user' | 'assistant' | 'system';
  /** Flat text content — kept for backward compat, derived from blocks. */
  content: string;
  /** Canonical content as typed blocks.  Drives rendering. */
  blocks: ContentBlock[];
  /** Legacy thinking field — will be migrated to ThinkingBlock. */
  thinking?: string;
  thinkingExpanded?: boolean;
  timestamp: number;
}

// ── App config ──────────────────────────────────────────────────────

export interface AppConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Provider name (anthropic, openai, deepseek, etc.) */
  provider?: string;
  /** HTTP/HTTPS proxy URL */
  proxy?: string;
  /** Maximum output tokens */
  maxTokens?: number;
}

// ── Chat state ──────────────────────────────────────────────────────

export type AgentMode = 'plan' | 'ask' | 'auto';

export interface ChatState {
  messages: Message[];
  isStreaming: boolean;
  model: string;
  error: string | null;
  inputText: string;
  cursorPosition: number;
  /** Current permission/execution mode. */
  mode: AgentMode;
  /** Per-turn summaries for TurnBoundary rendering. */
  turns: TurnSummary[];
  /** Monotonically increasing turn counter. */
  currentTurnId: number;
}

// ── Chat actions ────────────────────────────────────────────────────

export type BlockDeltaType = 'text' | 'thinking' | 'json';

export type ChatAction =
  // Input
  | { type: 'SET_INPUT'; text: string }
  | { type: 'INSERT_CHAR'; char: string }
  | { type: 'DELETE_CHAR'; position: 'before' | 'after' }
  | { type: 'SET_CURSOR'; position: number }
  // Messages
  | { type: 'ADD_USER_MESSAGE'; message: Message }
  | { type: 'START_ASSISTANT_RESPONSE'; id: number }
  // ContentBlock streaming
  | { type: 'START_BLOCK'; messageId: number; block: ContentBlock }
  | { type: 'APPEND_BLOCK_DELTA'; messageId: number; deltaType: BlockDeltaType; text: string }
  | { type: 'STOP_BLOCK'; messageId: number }
  // Legacy streaming (kept during transition)
  | { type: 'APPEND_ASSISTANT_TEXT'; id: number; text: string }
  | { type: 'APPEND_ASSISTANT_THINKING'; id: number; text: string }
  // Lifecycle
  | { type: 'FINISH_ASSISTANT_RESPONSE'; id: number }
  | { type: 'UPDATE_BLOCK_STATE'; toolId: string; state: ToolUseState }
  | { type: 'SET_TOOL_USE_RESULT'; toolId: string; duration?: number; result: ToolUseBlock['result'] }
  | { type: 'TOGGLE_THINKING'; id: number }
  | { type: 'SET_MODE'; mode: AgentMode }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'CLEAR_ERROR' }
  | { type: 'CLEAR_CHAT' };

// ── Streaming callbacks (API client → App) ──────────────────────────

export interface StreamCallbacks {
  /** A new content block has started (text / thinking / tool_use). */
  onBlockStart: (block: ContentBlock) => void;
  /** Delta content for the currently-open block. */
  onBlockDelta: (deltaType: BlockDeltaType, text: string) => void;
  /** The current block is complete. */
  onBlockStop: () => void;
  /** The entire stream finished successfully. */
  onDone: () => void;
  /** A non-abort error occurred. */
  onError: (error: Error) => void;
}
