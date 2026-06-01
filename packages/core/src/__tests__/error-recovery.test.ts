import { describe, expect, it } from 'vitest';
import {
  classifyError,
  computeBackoff,
  delay,
  withRetry,
  MaxTurnsExceededError,
  BudgetExceededError,
  StopRequestedError,
  FatalAPIError,
  ContextOverflowError,
} from '../error-recovery.js';

// ---------------------------------------------------------------------------
// classifyError
// ---------------------------------------------------------------------------

describe('classifyError', () => {
  it('should classify rate limit errors', () => {
    const result = classifyError(new Error('Rate limit exceeded'));
    expect(result.category).toBe('rate_limit');
    expect(result.retryable).toBe(true);
  });

  it('should classify 429 errors', () => {
    const result = classifyError(new Error('HTTP 429 too many requests'));
    expect(result.category).toBe('rate_limit');
    expect(result.retryable).toBe(true);
  });

  it('should classify quota errors', () => {
    const result = classifyError(new Error('API quota exceeded'));
    expect(result.category).toBe('rate_limit');
  });

  it('should classify server errors', () => {
    const result = classifyError(new Error('Internal server error'));
    expect(result.category).toBe('server_error');
    expect(result.retryable).toBe(true);
  });

  it('should classify 500 errors', () => {
    const result = classifyError(new Error('HTTP 500'));
    expect(result.category).toBe('server_error');
  });

  it('should classify 503 errors', () => {
    const result = classifyError(new Error('Service unavailable 503'));
    expect(result.category).toBe('server_error');
  });

  it('should classify overloaded errors', () => {
    const result = classifyError(new Error('Server overloaded'));
    expect(result.category).toBe('overloaded');
    expect(result.retryable).toBe(true);
  });

  it('should classify capacity errors', () => {
    const result = classifyError(new Error('At capacity'));
    expect(result.category).toBe('overloaded');
  });

  it('should classify network errors', () => {
    const result = classifyError(new Error('ECONNREFUSED'));
    expect(result.category).toBe('network');
    expect(result.retryable).toBe(true);
  });

  it('should classify fetch failed errors', () => {
    const result = classifyError(new Error('fetch failed'));
    expect(result.category).toBe('network');
  });

  it('should classify timeout errors', () => {
    const result = classifyError(new Error('Request timed out'));
    expect(result.category).toBe('timeout');
    expect(result.retryable).toBe(true);
  });

  it('should classify abort errors by name', () => {
    // Use AbortError name WITHOUT "abort" in message to avoid matching timeout check first
    const abortError = new Error('User cancelled operation');
    abortError.name = 'AbortError';
    const result = classifyError(abortError);
    expect(result.category).toBe('aborted');
    expect(result.retryable).toBe(false);
  });

  it('should classify 400 errors as invalid_request', () => {
    const result = classifyError(new Error('HTTP 400 bad request'));
    expect(result.category).toBe('invalid_request');
    expect(result.retryable).toBe(false);
  });

  it('should classify 401 errors as auth', () => {
    const result = classifyError(new Error('HTTP 401 unauthorized'));
    expect(result.category).toBe('auth');
    expect(result.retryable).toBe(false);
  });

  it('should classify 403 errors as auth', () => {
    const result = classifyError(new Error('HTTP 403 forbidden'));
    expect(result.category).toBe('auth');
  });

  it('should classify context too large errors', () => {
    const result = classifyError(new Error('Prompt too long'));
    expect(result.category).toBe('context_too_large');
    expect(result.retryable).toBe(false);
  });

  it('should classify 413 errors', () => {
    const result = classifyError(new Error('HTTP 413 too many tokens'));
    expect(result.category).toBe('context_too_large');
  });

  it('should classify unknown errors', () => {
    const result = classifyError(new Error('Something weird happened'));
    expect(result.category).toBe('unknown');
    expect(result.retryable).toBe(false);
  });

  it('should preserve the original error', () => {
    const original = new Error('test');
    const result = classifyError(original);
    expect(result.original).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// computeBackoff
// ---------------------------------------------------------------------------

describe('computeBackoff', () => {
  it('should return base delay for attempt 0', () => {
    const delay = computeBackoff(0, { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000, retryableCategories: new Set() });
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThanOrEqual(1500); // base + jitter (max 50%)
  });

  it('should increase with each attempt', () => {
    const d0 = computeBackoff(0);
    const d1 = computeBackoff(1);
    const d2 = computeBackoff(2);
    expect(d1).toBeGreaterThan(d0);
    expect(d2).toBeGreaterThan(d1);
  });

  it('should not exceed maxDelayMs', () => {
    const delay = computeBackoff(10, { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 5000, retryableCategories: new Set() });
    expect(delay).toBeLessThanOrEqual(5000);
  });
});

// ---------------------------------------------------------------------------
// delay
// ---------------------------------------------------------------------------

describe('delay', () => {
  it('should wait for specified time', async () => {
    const start = Date.now();
    await delay(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40); // Allow small timing variance
  });
});

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

describe('withRetry', () => {
  it('should return result on first success', async () => {
    const result = await withRetry(async () => 'success');
    expect(result).toBe('success');
  });

  it('should retry on retryable error', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 2) throw new Error('Rate limit exceeded');
        return 'retried';
      },
      { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, retryableCategories: new Set(['rate_limit']) },
    );
    expect(result).toBe('retried');
    expect(calls).toBe(2);
  });

  it('should not retry on non-retryable error', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('HTTP 401 unauthorized');
        },
        { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, retryableCategories: new Set(['rate_limit', 'server_error', 'network', 'timeout']) },
      ),
    ).rejects.toThrow('HTTP 401 unauthorized');
    expect(calls).toBe(1);
  });

  it('should throw after max retries', async () => {
    await expect(
      withRetry(
        async () => { throw new Error('Rate limit exceeded'); },
        { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100, retryableCategories: new Set(['rate_limit']) },
      ),
    ).rejects.toThrow('Rate limit exceeded');
  });

  it('should handle non-Error throws', async () => {
    await expect(
      withRetry(
        async () => { throw 'string error'; },
        { maxRetries: 0 },
      ),
    ).rejects.toThrow('string error');
  });
});

// ---------------------------------------------------------------------------
// Error Classes
// ---------------------------------------------------------------------------

describe('Error classes', () => {
  it('MaxTurnsExceededError should contain maxTurns', () => {
    const err = new MaxTurnsExceededError(50);
    expect(err.name).toBe('MaxTurnsExceededError');
    expect(err.maxTurns).toBe(50);
    expect(err.message).toContain('50');
  });

  it('BudgetExceededError should contain totalCost', () => {
    const err = new BudgetExceededError(10.50);
    expect(err.name).toBe('BudgetExceededError');
    expect(err.totalCost).toBe(10.50);
    expect(err.message).toContain('$10.50');
  });

  it('StopRequestedError should contain reason', () => {
    const err = new StopRequestedError('user abort');
    expect(err.name).toBe('StopRequestedError');
    expect(err.reason).toBe('user abort');
  });

  it('FatalAPIError should contain category', () => {
    const err = new FatalAPIError('API key invalid', 'auth');
    expect(err.name).toBe('FatalAPIError');
    expect(err.category).toBe('auth');
  });

  it('ContextOverflowError should contain ratio as percentage', () => {
    const err = new ContextOverflowError(0.96);
    expect(err.name).toBe('ContextOverflowError');
    expect(err.ratio).toBe(0.96);
    expect(err.message).toContain('96%');
  });
});
