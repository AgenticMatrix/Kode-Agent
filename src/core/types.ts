/**
 * Core shared types — aggregated from CoderAgent's @coder/shared.
 *
 * Only the types actually imported by query-engine.ts and query.ts are included.
 */

// ── Message types ─────────────────────────────────────────────────────

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image' | 'thinking';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
  source?: ImageSource;
  thinking?: string;
  signature?: string;
}

export interface ImageSource {
  type: 'base64';
  media_type: string;
  data: string;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
}

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface TextDelta {
  type: 'text_delta';
  text: string;
}

export interface InputJsonDelta {
  type: 'input_json_delta';
  partial_json: string;
}

export interface ThinkingDelta {
  type: 'thinking_delta';
  thinking: string;
}

// ── Completion / Stream types ─────────────────────────────────────────

export type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'refusal';

export interface CompletionUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  totalCost?: number;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | TextBlock[];
  is_error?: boolean;
  /** Execution duration in milliseconds. */
  duration?: number;
  /** Tool-specific structured metadata. */
  metadata?: Record<string, unknown>;
}

export interface AssistantMessage extends Message {
  role: 'assistant';
  stopReason: StopReason;
  usage: CompletionUsage;
  model: string;
  readonly toolUseBlocks: ToolUseBlock[];
}

export interface UserMessage extends Message {
  role: 'user';
  content: string | ContentBlock[];
}

// ── Stream events ─────────────────────────────────────────────────────

export interface ContentBlockStartEvent {
  type: 'content_block_start';
  index: number;
  content_block: ContentBlock;
}

export interface ContentBlockDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta: TextDelta | InputJsonDelta | ThinkingDelta;
}

export interface ContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
}

export interface MessageStartEvent {
  type: 'message_start';
  message: { model: string; usage?: CompletionUsage };
}

export interface MessageDeltaEvent {
  type: 'message_delta';
  delta: { stop_reason: StopReason | null; usage?: CompletionUsage };
}

export interface MessageStopEvent {
  type: 'message_stop';
  message: AssistantMessage;
}

export interface PingEvent {
  type: 'ping';
}

export interface CostUpdateEvent {
  type: 'cost_update';
  totalCost: number;
}

export type StreamEvent =
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageStartEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | PingEvent
  | CostUpdateEvent;

// ── Query message (yielded by agent loop) ─────────────────────────────

export interface DeferredPermission {
  toolName: string;
  command: string;
  description: string;
  toolUseId: string;
  resolve: (allowed: boolean) => void;
  promise: Promise<boolean>;
}

export interface ToolProgress {
  toolName: string;
  toolUseId: string;
  status: 'started' | 'running' | 'completed';
  message?: string;
  percent?: number;
  is_error?: boolean;
}

export interface CompactMetadata {
  beforeTokens: number;
  afterTokens: number;
  strategy: 'none' | 'snip' | 'auto' | 'summarize' | 'time_based' | 'cache_edit';
}

export class AgentError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
    public override readonly cause?: Error,
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

export type QueryMessage =
  | { type: 'stream_event'; event: StreamEvent }
  | { type: 'assistant'; message: AssistantMessage }
  | { type: 'user'; message: UserMessage }
  | { type: 'system'; subtype: 'compact_boundary'; compactMetadata: CompactMetadata }
  | { type: 'system'; subtype: 'error'; error: AgentError }
  | { type: 'system'; subtype: 'progress'; data: ToolProgress }
  | { type: 'system'; subtype: 'permission_required'; deferred: DeferredPermission };

// ── Permission ────────────────────────────────────────────────────────

export enum PermissionMode {
  PLAN = 'plan',
  ASK = 'ask',
  AUTO = 'auto',
}

export enum RiskLevel {
  SAFE = 'safe',
  MUTATION = 'mutation',
  DESTRUCTIVE = 'destructive',
}

// ── Tool ──────────────────────────────────────────────────────────────

export interface ToolContext {
  sessionId: string;
  cwd: string;
  signal?: AbortSignal;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  riskLevel?: RiskLevel;
}

export interface ToolExecutionResult {
  content: string;
  isError: boolean;
  truncated?: boolean;
  /** Execution duration in milliseconds. */
  duration?: number;
  /** Tool-specific structured metadata carried through to the result renderer. */
  metadata?: Record<string, unknown>;
}

// ── Session ───────────────────────────────────────────────────────────

export type SessionStatus = 'active' | 'paused' | 'completed' | 'error' | 'archived';

export interface TokenUsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  totalCost?: number;
  totalTokens?: number;
}

export interface SessionMetadata {
  tags?: string[];
  notes?: string;
  filesModified?: string[];
  toolsUsed?: string[];
}

// ── Session filter / summary ──────────────────────────────────────────

export interface SessionFilter {
  status?: SessionStatus;
  model?: string;
  provider?: string;
  since?: Date;
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

export interface Session {
  id: string;
  title: string;
  status: SessionStatus;
  messages: Message[];
  turnCount: number;
  totalCost: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  cwd: string;
  baseCommit?: string;
  parentSessionId?: string;
  model: string;
  provider: string;
  tokenUsage: TokenUsageSummary;
  metadata: SessionMetadata;
}
