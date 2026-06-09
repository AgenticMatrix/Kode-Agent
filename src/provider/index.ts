/**
 * @codingagent/provider — LLM provider abstraction layer.
 *
 * Supports Anthropic Messages API, OpenAI-compatible endpoints, and DeepSeek.
 * Provides automatic model routing based on task complexity.
 */

// Base types and interface
export type {
  Provider,
  ProviderConfig,
  ProviderResponse,
  NormalizedContentBlock,
  ModelConfig,
  ThinkingConfig,
  StreamEvent,
  Usage,
  ModelInfo,
  TextDeltaEvent,
  ToolUseStartEvent,
  ToolUseDeltaEvent,
  ToolUseEndEvent,
  MessageStartEvent,
  MessageStopEvent,
  ThinkingEvent,
  ErrorEvent,
} from './base.js';

export { calculateCost, CODER_PRICING } from './base.js';

// Provider message types
export type {
  ProviderMessage,
  ProviderContentBlock,
  ProviderToolDefinition,
} from './types.js';

// Anthropic provider
export { AnthropicProvider } from './anthropic.js';

// OpenAI Compat provider
export { OpenAICompatProvider } from './openai-compat.js';

// DeepSeek provider
export { DeepSeekProvider } from './deepseek.js';

// Provider Router
export {
  ProviderRouter,
  classifyTaskComplexity,
  createDefaultRouter,
} from './router.js';
export type {
  TaskComplexity,
  ProviderEntry,
  RouteResult,
  ComplexityRoute,
} from './router.js';

// Lazy dependency loading
export {
  ensureProviderSDK,
  isProviderSDKAvailable,
  getProviderSdkInfo,
  listProviderSDKs,
} from './lazy-deps.js';
export type { SdkInfo } from './lazy-deps.js';

// Retry utilities
export { withRetry, classifyError } from './retry.js';
export type { RetryConfig, ClassifiedError, ErrorClass } from './retry.js';
