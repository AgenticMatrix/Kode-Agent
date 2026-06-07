/**
 * Retry strategy with exponential backoff and error classification.
 *
 * Handles transient errors (rate limits, server errors, overloaded)
 * with exponential backoff + jitter, while failing fast on permanent
 * errors (auth, bad request).
 */

// ---------------------------------------------------------------------------
// Error Classification
// ---------------------------------------------------------------------------

export type ErrorClass =
  | 'rate_limit'    // 429 — too many requests
  | 'server_error'  // 5xx — server-side failure
  | 'overloaded'    // 529 — provider overloaded
  | 'auth'          // 401/403 — bad credentials (not retryable)
  | 'bad_request'   // 400 — invalid input (not retryable)
  | 'network'       // Connection timeout / DNS (retryable)
  | 'unknown';      // Unclassified

export interface ClassifiedError {
  error: Error;
  class: ErrorClass;
  retryable: boolean;
  statusCode?: number;
}

/**
 * Classify an error into a known category.
 *
 * Handles Anthropic SDK error types, standard fetch errors,
 * and generic Error objects.
 */
export function classifyError(error: unknown): ClassifiedError {
  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message.toLowerCase();

  // Anthropic SDK error types (check constructor name)
  const errorName = err.constructor.name;

  // Rate Limit (Anthropic SDK: RateLimitError, generic: 429)
  if (errorName === 'RateLimitError' || message.includes('429') || message.includes('rate limit')) {
    return { error: err, class: 'rate_limit', retryable: true, statusCode: 429 };
  }

  // Authentication (Anthropic SDK: AuthenticationError, generic: 401/403)
  if (errorName === 'AuthenticationError' || errorName === 'PermissionDeniedError' ||
      message.includes('401') || message.includes('403') || message.includes('unauthorized') ||
      message.includes('invalid api key') || message.includes('incorrect api key')) {
    return { error: err, class: 'auth', retryable: false, statusCode: message.includes('403') ? 403 : 401 };
  }

  // Bad Request (Anthropic SDK: BadRequestError)
  if (errorName === 'BadRequestError' || message.includes('400') || message.includes('bad request')) {
    return { error: err, class: 'bad_request', retryable: false, statusCode: 400 };
  }

  // Internal Server Error (Anthropic SDK: InternalServerError, generic: 5xx)
  if (errorName === 'InternalServerError' ||
      message.includes('500') || message.includes('internal server error') ||
      message.includes('503') || message.includes('service unavailable')) {
    return { error: err, class: 'server_error', retryable: true, statusCode: 500 };
  }

  // Overloaded (Anthropic returns 529 for overloaded)
  if (message.includes('529') || message.includes('overloaded')) {
    return { error: err, class: 'overloaded', retryable: true, statusCode: 529 };
  }

  // Network errors (connection refused, timeout, DNS, etc.)
  if (errorName === 'APIConnectionError' || errorName === 'APIConnectionTimeoutError' ||
      message.includes('econnrefused') || message.includes('enotfound') ||
      message.includes('etimedout') || message.includes('network') ||
      message.includes('fetch failed') || message.includes('socket hang up') ||
      message.includes('connection reset')) {
    return { error: err, class: 'network', retryable: true };
  }

  // User abort (AbortError)
  if (errorName === 'AbortError' || errorName === 'APIUserAbortError' ||
      message.includes('abort') || message.includes('cancelled')) {
    return { error: err, class: 'unknown', retryable: false };
  }

  // Default: assume not retryable
  return { error: err, class: 'unknown', retryable: false };
}

// ---------------------------------------------------------------------------
// Retry Configuration
// ---------------------------------------------------------------------------

export interface RetryConfig {
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in milliseconds (default: 1000 = 1s) */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds (default: 30000 = 30s) */
  maxDelayMs?: number;
  /** Jitter factor (0–1, default: 0.2 = ±20%) */
  jitter?: number;
  /** Custom error classifier — defaults to classifyError() */
  classifyError?: (error: unknown) => ClassifiedError;
  /** Called before each retry */
  onRetry?: (attempt: number, error: ClassifiedError, delayMs: number) => void;
}

// ---------------------------------------------------------------------------
// Delay Calculation
// ---------------------------------------------------------------------------

/**
 * Calculate the delay for a given retry attempt using exponential backoff + jitter.
 *
 * Delay = min(baseDelay * 2^attempt + randomJitter, maxDelay)
 * Jitter: ±20% random variation to avoid thundering herd.
 */
export function calculateDelay(
  attempt: number,
  config: Required<RetryConfig>,
): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  const jitterRange = exponentialDelay * config.jitter;
  const jitter = (Math.random() * 2 - 1) * jitterRange; // ±jitter
  return Math.min(exponentialDelay + jitter, config.maxDelayMs);
}

// ---------------------------------------------------------------------------
// Retry Wrapper
// ---------------------------------------------------------------------------

const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitter: 0.2,
  classifyError: classifyError,
  onRetry: () => {},
};

/**
 * Execute an async function with automatic retry on transient errors.
 *
 * @param fn — The async function to execute (will be called fresh each retry)
 * @param config — Retry configuration
 * @returns The result of `fn` if it eventually succeeds
 * @throws The original error if all retries are exhausted or the error is not retryable
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => fetchFromAPI(),
 *   { maxRetries: 3, baseDelayMs: 1000 }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {},
): Promise<T> {
  const effectiveConfig: Required<RetryConfig> = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  };

  let lastError: ClassifiedError | null = null;

  for (let attempt = 0; attempt <= effectiveConfig.maxRetries; attempt++) {
    try {
      const result = await fn();
      return result;
    } catch (error: unknown) {
      const classified = effectiveConfig.classifyError(error);
      lastError = classified;

      // If not retryable OR this was the last attempt, throw
      if (!classified.retryable || attempt === effectiveConfig.maxRetries) {
        throw classified.error;
      }

      const delayMs = calculateDelay(attempt, effectiveConfig);

      effectiveConfig.onRetry(attempt + 1, classified, delayMs);

      await sleep(delayMs);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError?.error ?? new Error('Retry exhausted with no error');
}

/**
 * Sleep for a given duration in milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
