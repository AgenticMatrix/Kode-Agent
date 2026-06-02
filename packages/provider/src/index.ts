/**
 * @coder/provider — Coder Agent provider abstraction layer.
 *
 * Phase 1: Anthropic Messages API (streaming + withRetry).
 * Phase 4: OpenAI-compatible, DeepSeek, auto-routing via ProviderRouter.
 */

// Base types and interface
export type {
  Provider,
  ProviderConfig,
  ProviderResponse,
  ProviderContentBlock,
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
