/**
 * Retry strategy with exponential backoff and error classification.
 */

// ---------------------------------------------------------------------------
// Error Classification
// ---------------------------------------------------------------------------

export type ErrorClass =
  | 'rate_limit'
  | 'server_error'
  | 'overloaded'
  | 'auth'
  | 'bad_request'
  | 'network'
  | 'unknown';

export interface ClassifiedError {
  error: Error;
  class: ErrorClass;
  retryable: boolean;
  statusCode?: number;
}

export function classifyError(error: unknown): ClassifiedError {
  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message.toLowerCase();
  const errorName = err.constructor.name;

  if (errorName === 'RateLimitError' || message.includes('429') || message.includes('rate limit')) {
    return { error: err, class: 'rate_limit', retryable: true, statusCode: 429 };
  }

  if (errorName === 'AuthenticationError' || errorName === 'PermissionDeniedError' ||
      message.includes('401') || message.includes('403') || message.includes('unauthorized') ||
      message.includes('invalid api key') || message.includes('incorrect api key')) {
    return { error: err, class: 'auth', retryable: false, statusCode: message.includes('403') ? 403 : 401 };
  }

  if (errorName === 'BadRequestError' || message.includes('400') || message.includes('bad request')) {
    return { error: err, class: 'bad_request', retryable: false, statusCode: 400 };
  }

  if (errorName === 'InternalServerError' ||
      message.includes('500') || message.includes('internal server error') ||
      message.includes('503') || message.includes('service unavailable')) {
    return { error: err, class: 'server_error', retryable: true, statusCode: 500 };
  }

  if (message.includes('529') || message.includes('overloaded')) {
    return { error: err, class: 'overloaded', retryable: true, statusCode: 529 };
  }

  if (errorName === 'APIConnectionError' || errorName === 'APIConnectionTimeoutError' ||
      message.includes('econnrefused') || message.includes('enotfound') ||
      message.includes('etimedout') || message.includes('network') ||
      message.includes('fetch failed') || message.includes('socket hang up') ||
      message.includes('connection reset')) {
    return { error: err, class: 'network', retryable: true };
  }

  if (errorName === 'AbortError' || errorName === 'APIUserAbortError' ||
      message.includes('abort') || message.includes('cancelled')) {
    return { error: err, class: 'unknown', retryable: false };
  }

  return { error: err, class: 'unknown', retryable: false };
}

// ---------------------------------------------------------------------------
// Retry Configuration
// ---------------------------------------------------------------------------

export interface RetryConfig {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: number;
  classifyError?: (error: unknown) => ClassifiedError;
  onRetry?: (attempt: number, error: ClassifiedError, delayMs: number) => void;
}

// ---------------------------------------------------------------------------
// Delay Calculation
// ---------------------------------------------------------------------------

export function calculateDelay(
  attempt: number,
  config: Required<RetryConfig>,
): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  const jitterRange = exponentialDelay * config.jitter;
  const jitter = (Math.random() * 2 - 1) * jitterRange;
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
      return await fn();
    } catch (error: unknown) {
      const classified = effectiveConfig.classifyError(error);
      lastError = classified;

      if (!classified.retryable || attempt === effectiveConfig.maxRetries) {
        throw classified.error;
      }

      const delayMs = calculateDelay(attempt, effectiveConfig);
      effectiveConfig.onRetry(attempt + 1, classified, delayMs);
      await sleep(delayMs);
    }
  }

  throw lastError?.error ?? new Error('Retry exhausted with no error');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
