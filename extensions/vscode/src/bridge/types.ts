/**
 * bridge-types.ts — Minimal type definitions for the bridge layer.
 * Self-contained so the extension doesn't depend on parent engine types.
 */

export interface DeferredPermission {
  toolUseId: string;
  toolName: string;
  command: string;
  description: string;
  resolve: (allowed: boolean) => void;
}

export interface CompletionUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  totalCost?: number;
}

export interface StreamEvent {
  type: string;
  message?: { model?: string; usage?: CompletionUsage };
  delta?: { type: string; text?: string; partial_json?: string; thinking?: string; stop_reason?: string; usage?: CompletionUsage };
  content_block?: { type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string; thinking?: string };
  index: number;
  totalCost?: number;
}

export interface AssistantMessage {
  role: 'assistant';
  content: string | ContentBlock[];
  stopReason?: StopReason;
  usage?: CompletionUsage;
  model?: string;
  toolUseBlocks?: ToolUseBlock[];
}

export interface ContentBlock {
  type: string;
  text?: string;
  content?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  thinking?: string;
  tool_use_id?: string;
  is_error?: boolean;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'refusal';

export interface ToolProgress {
  toolUseId: string;
  toolName: string;
  status: 'started' | 'running' | 'completed';
  is_error?: boolean;
  message?: string;
}

export interface CompactMetadata {
  beforeTokens: number;
  afterTokens: number;
  strategy: string;
}

export interface QueryMessage {
  type: 'stream_event' | 'assistant' | 'user' | 'system';
  subtype?: string;
  event?: StreamEvent;
  message?: AssistantMessage;
  data?: any;
  error?: any;
  compactMetadata?: CompactMetadata;
  deferred?: DeferredPermission;
}

export class AgentError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
