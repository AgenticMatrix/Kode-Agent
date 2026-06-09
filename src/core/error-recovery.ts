/**
 * error-recovery.ts — Error classification and retry strategy
 *
 * Categorizes API errors into retryable vs. fatal, implements
 * exponential backoff with jitter, and provides the `withRetry` wrapper.
 *
 * LLM API error recovery with retry pattern:
 * - retryable: rate_limit, server_error, overloaded
 * - non-retryable: invalid_request, auth, permission, context_too_large
 */

// ---------------------------------------------------------------------------
// Error Classification
// ---------------------------------------------------------------------------

export type ErrorCategory =
  | 'rate_limit'
  | 'server_error'
  | 'overloaded'
  | 'network'
  | 'invalid_request'
  | 'auth'
  | 'permission'
  | 'context_too_large'
  | 'timeout'
  | 'aborted'
  | 'unknown';

export interface ClassifiedError {
  category: ErrorCategory;
  retryable: boolean;
  message: string;
  original: Error;
}

const RETRYABLE_CATEGORIES = new Set<ErrorCategory>([
  'rate_limit',
  'server_error',
  'overloaded',
  'network',
  'timeout',
]);

/**
 * Classify an error by analyzing its message and properties.
 */
export function classifyError(error: Error): ClassifiedError {
  const message = error.message.toLowerCase();

  // Rate limiting
  if (
    message.includes('rate limit') ||
    message.includes('429') ||
    message.includes('too many requests') ||
    message.includes('ratelimit') ||
    message.includes('quota')
  ) {
    return { category: 'rate_limit', retryable: true, message: error.message, original: error };
  }

  // Server errors
  if (
    message.includes('internal server error') ||
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('server error')
  ) {
    return { category: 'server_error', retryable: true, message: error.message, original: error };
  }

  // Overloaded
  if (
    message.includes('overloaded') ||
    message.includes('capacity') ||
    message.includes('busy')
  ) {
    return { category: 'overloaded', retryable: true, message: error.message, original: error };
  }

  // Network
  if (
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('network') ||
    message.includes('fetch failed') ||
    message.includes('socket hang up')
  ) {
    return { category: 'network', retryable: true, message: error.message, original: error };
  }

  // Timeout
  if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('aborted')
  ) {
    return { category: 'timeout', retryable: true, message: error.message, original: error };
  }

  // Aborted (user interrupt)
  if (error.name === 'AbortError' || message.includes('abort')) {
    return { category: 'aborted', retryable: false, message: error.message, original: error };
  }

  // Invalid request
  if (
    message.includes('invalid') ||
    message.includes('400') ||
    message.includes('bad request')
  ) {
    return { category: 'invalid_request', retryable: false, message: error.message, original: error };
  }

  // Auth
  if (
    message.includes('401') ||
    message.includes('403') ||
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('auth')
  ) {
    return { category: 'auth', retryable: false, message: error.message, original: error };
  }

  // Context too large
  if (
    message.includes('prompt too long') ||
    message.includes('context length') ||
    message.includes('too many tokens') ||
    message.includes('413')
  ) {
    return { category: 'context_too_large', retryable: false, message: error.message, original: error };
  }

  return { category: 'unknown', retryable: false, message: error.message, original: error };
}

// ---------------------------------------------------------------------------
// Retry Strategy
// ---------------------------------------------------------------------------

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableCategories: Set<ErrorCategory>;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  retryableCategories: RETRYABLE_CATEGORIES,
};

/**
 * Compute exponential backoff delay with jitter.
 *
 * delay = min(baseDelay * 2^attempt + random_jitter, maxDelay)
 */
export function computeBackoff(attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
  const baseDelay = config.baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseDelay * 0.5;
  return Math.min(baseDelay + jitter, config.maxDelayMs);
}

/**
 * Wait for a specified number of milliseconds.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

/**
 * Execute an async function with automatic retry on transient failures.
 *
 * Retries on: rate_limit, server_error, overloaded, network, timeout
 * Does not retry on: invalid_request, auth, permission, context_too_large, aborted
 *
 * @param fn - The async function to execute
 * @param config - Retry configuration (optional)
 * @returns The result of the function
 * @throws The last error if all retries are exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config?: Partial<RetryConfig>,
): Promise<T> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const classified = classifyError(lastError);

      // Don't retry if not retryable or max attempts reached
      if (!classified.retryable || attempt >= cfg.maxRetries) {
        throw lastError;
      }

      // Don't retry if category not in allowed list
      if (cfg.retryableCategories && !cfg.retryableCategories.has(classified.category)) {
        throw lastError;
      }

      const waitMs = computeBackoff(attempt, cfg);
      await delay(waitMs);
    }
  }

  throw lastError ?? new Error('withRetry: unexpected error');
}

// ---------------------------------------------------------------------------
// Specific Error Classes
// ---------------------------------------------------------------------------

export class MaxTurnsExceededError extends Error {
  constructor(public readonly maxTurns: number) {
    super(`Exceeded maximum of ${maxTurns} turns`);
    this.name = 'MaxTurnsExceededError';
  }
}

export class BudgetExceededError extends Error {
  constructor(public readonly totalCost: number) {
    super(`Budget exceeded at $${totalCost.toFixed(2)}`);
    this.name = 'BudgetExceededError';
  }
}

export class StopRequestedError extends Error {
  constructor(public readonly reason: string) {
    super(`Stop requested: ${reason}`);
    this.name = 'StopRequestedError';
  }
}

export class FatalAPIError extends Error {
  constructor(
    message: string,
    public readonly category: ErrorCategory,
  ) {
    super(message);
    this.name = 'FatalAPIError';
  }
}

export class ContextOverflowError extends Error {
  constructor(public readonly ratio: number) {
    super(`Context overflow: ${(ratio * 100).toFixed(0)}% of budget`);
    this.name = 'ContextOverflowError';
  }
}
