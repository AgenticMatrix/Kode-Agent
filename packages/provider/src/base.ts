/**
 * Provider base interface — common contract for all LLM providers.
 *
 * Every provider (Anthropic, OpenAI, DeepSeek) implements this interface.
 * The Agent Loop calls `stream()` to get a streaming response and
 * `abort()` to cancel an in-flight request.
 */

import type { Message } from '@coder/shared';
import type { ToolDefinition } from '@coder/shared';

// ---------------------------------------------------------------------------
// Provider Configuration
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  /** API key for the provider */
  apiKey: string;
  /** Base URL override (for proxies / alternative endpoints) */
  baseUrl?: string;
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
  /** The incremental text chunk */
  text: string;
}

export interface ToolUseStartEvent {
  type: 'tool_use_start';
  /** Unique tool use ID */
  id: string;
  /** Tool name */
  name: string;
  /** Initial accumulated input JSON (may be partial) */
  input: Record<string, unknown>;
}

export interface ToolUseDeltaEvent {
  type: 'tool_use_delta';
  /** Tool use ID this delta belongs to */
  id: string;
  /** Incremental JSON fragment */
  partialJson: string;
}

export interface ToolUseEndEvent {
  type: 'tool_use_end';
  /** Tool use ID */
  id: string;
  /** The complete parsed input */
  input: Record<string, unknown>;
}

export interface MessageStartEvent {
  type: 'message_start';
  /** The model being used */
  model: string;
  /** Initial usage info (often partial) */
  usage?: Usage;
}

export interface MessageStopEvent {
  type: 'message_stop';
  /** The stop reason from the model */
  stopReason: string;
  /** Cumulative usage across the full response */
  usage: Usage;
}

export interface ThinkingEvent {
  type: 'thinking';
  /** Thinking content (incremental) */
  thinking: string;
  /** Whether this is the start/ongoing/end of a thinking block */
  phase: 'start' | 'delta' | 'end';
  /** Signature for redacted thinking */
  signature?: string;
}

export interface ErrorEvent {
  type: 'error';
  /** Error code for classification */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Whether this error is retryable */
  retryable: boolean;
  /** Original error for debugging */
  raw?: unknown;
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export interface Usage {
  /** Input tokens consumed */
  inputTokens: number;
  /** Output tokens generated */
  outputTokens: number;
  /** Cache creation input tokens */
  cacheCreationInputTokens?: number;
  /** Cache read input tokens */
  cacheReadInputTokens?: number;
  /** Total cost estimate in USD */
  totalCost?: number;
  /** Service tier (for Anthropic: "standard" | "batch" | "auto") */
  serviceTier?: string;
}

// ---------------------------------------------------------------------------
// Content Blocks (normalized from provider responses)
// ---------------------------------------------------------------------------

export type ProviderContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'thinking'; thinking: string; signature?: string };

// ---------------------------------------------------------------------------
// Provider Response
// ---------------------------------------------------------------------------

export interface ProviderResponse {
  /** All accumulated content blocks from the response */
  content: ProviderContentBlock[];
  /** Why the model stopped: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" */
  stopReason: string;
  /** Cumulative token usage and cost */
  usage: Usage;
}

// ---------------------------------------------------------------------------
// Model Info
// ---------------------------------------------------------------------------

export interface ModelInfo {
  /** Model identifier */
  id: string;
  /** Display name */
  name: string;
  /** Provider that hosts this model */
  provider: string;
  /** Max context window in tokens */
  contextWindow: number;
  /** Max output tokens */
  maxOutputTokens: number;
  /** Whether the model supports tool/function calling */
  supportsTools: boolean;
  /** Whether the model supports vision/image input */
  supportsVision: boolean;
  /** Pricing per 1M tokens (optional, for cost estimation) */
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
  /**
   * Stream a completion from the model.
   *
   * This is the primary method — all LLM interactions go through this.
   * The `onEvent` callback receives normalized stream events in real time,
   * and the returned Promise resolves with the complete response.
   *
   * @param modelConfig — Model selection and parameters
   * @param system — System prompt string
   * @param messages — Conversation history
   * @param tools — Available tool definitions (empty = no tools)
   * @param onEvent — Callback for each stream event
   * @returns The complete response with all content blocks and usage
   */
  stream(
    modelConfig: ModelConfig,
    system: string,
    messages: Message[],
    tools: ToolDefinition[],
    onEvent: (event: StreamEvent) => void,
  ): Promise<ProviderResponse>;

  /**
   * Abort the currently in-flight request.
   * Safe to call even if no request is in progress.
   */
  abort(): void;

  /**
   * List available models for this provider.
   */
  listModels(): Promise<ModelInfo[]>;
}

// ---------------------------------------------------------------------------
// Cost Calculation Helpers
// ---------------------------------------------------------------------------

/**
 * Anthropic pricing per 1M tokens (as of 2025).
 * Update these as pricing changes.
 */
export const ANTHROPIC_PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  'claude-sonnet-4-6': {
    input: 3.0,
    output: 15.0,
    cacheWrite: 3.75,
    cacheRead: 0.30,
  },
  'claude-sonnet-4-5': {
    input: 3.0,
    output: 15.0,
    cacheWrite: 3.75,
    cacheRead: 0.30,
  },
  'claude-opus-4-5': {
    input: 15.0,
    output: 75.0,
    cacheWrite: 18.75,
    cacheRead: 1.50,
  },
  'claude-opus-4': {
    input: 15.0,
    output: 75.0,
    cacheWrite: 18.75,
    cacheRead: 1.50,
  },
  'claude-haiku-4-5': {
    input: 0.80,
    output: 4.0,
    cacheWrite: 1.0,
    cacheRead: 0.08,
  },
  // Default: Sonnet pricing
  default: {
    input: 3.0,
    output: 15.0,
    cacheWrite: 3.75,
    cacheRead: 0.30,
  },
};

/**
 * Calculate cost in USD from token usage.
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens: number = 0,
  cacheReadTokens: number = 0,
): number {
  const pricing = ANTHROPIC_PRICING[model] ?? ANTHROPIC_PRICING.default!;

  let cost = 0;
  cost += (inputTokens / 1_000_000) * pricing.input;
  cost += (outputTokens / 1_000_000) * pricing.output;
  cost += (cacheWriteTokens / 1_000_000) * pricing.cacheWrite;
  cost += (cacheReadTokens / 1_000_000) * pricing.cacheRead;

  return Math.round(cost * 10000) / 10000; // Round to 4 decimal places
}
