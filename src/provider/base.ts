/**
 * Provider base interface — common contract for all LLM providers.
 *
 * Every provider (Anthropic, OpenAI, DeepSeek) implements this interface.
 * The Agent Loop calls `stream()` to get a streaming response and
 * `abort()` to cancel an in-flight request.
 */

import type { ProviderMessage, ProviderToolDefinition } from './types.js';

// ---------------------------------------------------------------------------
// Provider Configuration
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  /** API key for the provider */
  apiKey: string;
  /** Base URL override (for proxies / alternative endpoints) */
  baseUrl?: string;
  /** HTTP/HTTPS proxy URL (e.g. "http://127.0.0.1:7890") */
  proxy?: string;
  /** Request timeout in milliseconds (default: 300_000 = 5 min) */
  timeout?: number;
  /** Maximum retry attempts for retryable errors (default: 3) */
  maxRetries?: number;
}

// ---------------------------------------------------------------------------
// Model Configuration (per-request)
// ---------------------------------------------------------------------------

export interface ModelConfig {
  /** Model identifier (e.g. "deepseek-v4-pro", "gpt-4o") */
  model: string;
  /** Maximum output tokens */
  maxTokens?: number;
  /** Sampling temperature (0–1) */
  temperature?: number;
  /** Extended thinking configuration */
  thinking?: ThinkingConfig;
}

export interface ThinkingConfig {
  /** Thinking mode: "enabled", "adaptive", "disabled" */
  mode: 'enabled' | 'adaptive' | 'disabled';
  /** Budget in tokens for the thinking process */
  budgetTokens: number;
}

// ---------------------------------------------------------------------------
// Stream Events (provider-agnostic, normalized)
// ---------------------------------------------------------------------------

export type StreamEvent =
  | TextDeltaEvent
  | ToolUseStartEvent
  | ToolUseDeltaEvent
  | ToolUseEndEvent
  | MessageStartEvent
  | MessageStopEvent
  | ThinkingEvent
  | ErrorEvent;

export interface TextDeltaEvent {
  type: 'text_delta';
  text: string;
}

export interface ToolUseStartEvent {
  type: 'tool_use_start';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolUseDeltaEvent {
  type: 'tool_use_delta';
  id: string;
  partialJson: string;
}

export interface ToolUseEndEvent {
  type: 'tool_use_end';
  id: string;
  input: Record<string, unknown>;
}

export interface MessageStartEvent {
  type: 'message_start';
  model: string;
  usage?: Usage;
}

export interface MessageStopEvent {
  type: 'message_stop';
  stopReason: string;
  usage: Usage;
}

export interface ThinkingEvent {
  type: 'thinking';
  thinking: string;
  phase: 'start' | 'delta' | 'end';
  signature?: string;
}

export interface ErrorEvent {
  type: 'error';
  code: string;
  message: string;
  retryable: boolean;
  raw?: unknown;
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  totalCost?: number;
  serviceTier?: string;
}

// ---------------------------------------------------------------------------
// Provider Response (normalized)
// ---------------------------------------------------------------------------

export type NormalizedContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'thinking'; thinking: string; signature?: string };

export interface ProviderResponse {
  content: NormalizedContentBlock[];
  stopReason: string;
  usage: Usage;
}

// ---------------------------------------------------------------------------
// Model Info
// ---------------------------------------------------------------------------

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
  pricing?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
}

// ---------------------------------------------------------------------------
// Provider Interface
// ---------------------------------------------------------------------------

export interface Provider {
  stream(
    modelConfig: ModelConfig,
    system: string,
    messages: ProviderMessage[],
    tools: ProviderToolDefinition[],
    onEvent: (event: StreamEvent) => void,
  ): Promise<ProviderResponse>;

  abort(): void;

  listModels(): Promise<ModelInfo[]>;
}

// ---------------------------------------------------------------------------
// Cost Calculation Helpers
// ---------------------------------------------------------------------------

export const CODER_PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  'claude-sonnet-4-6': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-sonnet-4-5': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-opus-4-5': { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-opus-4': { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-haiku-4-5': { input: 0.80, output: 4.0, cacheWrite: 1.0, cacheRead: 0.08 },
  default: { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.30 },
};

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens: number = 0,
  cacheReadTokens: number = 0,
): number {
  const pricing = CODER_PRICING[model] ?? CODER_PRICING.default!;

  let cost = 0;
  cost += (inputTokens / 1_000_000) * pricing.input;
  cost += (outputTokens / 1_000_000) * pricing.output;
  cost += (cacheWriteTokens / 1_000_000) * pricing.cacheWrite;
  cost += (cacheReadTokens / 1_000_000) * pricing.cacheRead;

  return Math.round(cost * 10000) / 10000;
}
