/**
 * Core message types for the Kode Agent system.
 * Models the conversation between user, assistant, and system.
 */

// ---------------------------------------------------------------------------
// JSON Schema (lightweight)
// ---------------------------------------------------------------------------

export interface JSONSchemaProperty {
  type?: string | string[];
  description?: string;
  enum?: string[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Base Message
// ---------------------------------------------------------------------------

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
}

// ---------------------------------------------------------------------------
// Content Blocks (Anthropic-compatible)
// ---------------------------------------------------------------------------

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
  type: 'base64' | 'url';
  media_type: string;
  data?: string;
  url?: string;
}

// ---------------------------------------------------------------------------
// Typed Content Blocks
// ---------------------------------------------------------------------------

export interface TextBlock {
  type: 'text';
  text: string;
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
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

export interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64' | 'url';
    media_type: string;
    data?: string;
    url?: string;
  };
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export interface CompletionUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  totalCost?: number;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'refusal';

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

export interface SystemMessage {
  role: 'system';
  subtype: 'compact_boundary' | 'error' | 'progress' | 'checkpoint';
  content: string;
  metadata?: CompactMetadata | ErrorMetadata | ProgressMetadata;
}

export type MessageUnion = AssistantMessage | UserMessage | SystemMessage;

// ---------------------------------------------------------------------------
// Agent Loop Query Messages
// ---------------------------------------------------------------------------

export interface DeferredPermission {
  toolName: string;
  command: string;
  description: string;
  toolUseId: string;
  resolve: (allowed: boolean) => void;
  promise: Promise<boolean>;
}

export type QueryMessage =
  | { type: 'stream_event'; event: StreamEvent }
  | { type: 'assistant'; message: AssistantMessage }
  | { type: 'user'; message: UserMessage }
  | { type: 'system'; subtype: 'compact_boundary'; compactMetadata: CompactMetadata }
  | { type: 'system'; subtype: 'error'; error: AgentError }
  | { type: 'system'; subtype: 'progress'; data: ToolProgress }
  | { type: 'system'; subtype: 'permission_required'; deferred: DeferredPermission };

// ---------------------------------------------------------------------------
// Stream Events
// ---------------------------------------------------------------------------

export type StreamEvent =
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageStartEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | PingEvent
  | CostUpdateEvent;

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

// ---------------------------------------------------------------------------
// Tool Execution
// ---------------------------------------------------------------------------

export interface ToolResultBlockParam {
  tool_use_id: string;
  type: 'tool_result';
  content: string;
  is_error?: boolean;
}

export interface ToolProgress {
  toolName: string;
  toolUseId: string;
  status: 'started' | 'running' | 'completed';
  message?: string;
  percent?: number;
  /** Whether the tool execution resulted in an error */
  is_error?: boolean;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export interface CompactMetadata {
  beforeTokens: number;
  afterTokens: number;
  strategy: 'none' | 'snip' | 'auto' | 'summarize' | 'time_based' | 'cache_edit';
}

export interface ErrorMetadata {
  code: string;
  retryable: boolean;
  retriesAttempted?: number;
}

export interface ProgressMetadata {
  current: number;
  total: number;
  label?: string;
}

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

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

export class MaxTurnsExceededError extends AgentError {
  constructor(maxTurns: number) {
    super(`Exceeded maximum of ${maxTurns} turns`, 'MAX_TURNS', false);
  }
}

export class BudgetExceededError extends AgentError {
  constructor(totalCost: number) {
    super(`Budget exceeded at $${totalCost.toFixed(2)}`, 'BUDGET', false);
  }
}

export class StopRequestedError extends AgentError {
  constructor(reason: string) {
    super(`Stop requested: ${reason}`, 'STOP', false);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function createAssistantMessage(
  content: ContentBlock[],
  stopReason: StopReason,
  usage: CompletionUsage,
  model: string,
): AssistantMessage {
  const toolUseBlocks = content.filter(
    (b): b is ToolUseBlock => b.type === 'tool_use',
  );
  return {
    role: 'assistant',
    content,
    stopReason,
    usage,
    model,
    get toolUseBlocks() {
      return toolUseBlocks;
    },
  };
}
