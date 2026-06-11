import { describe, expect, it } from 'vitest';
import { classifyError, computeBackoff, RetryConfig } from '../../src/core/error-recovery.js';
import {
  MaxTurnsExceededError, BudgetExceededError, StopRequestedError,
  FatalAPIError, ContextOverflowError,
} from '../../src/core/error-recovery.js';

describe('classifyError', () => {
  it('should classify rate limit errors', () => {
    const result = classifyError(new Error('Rate limit exceeded'));
    expect(result.category).toBe('rate_limit');
    expect(result.retryable).toBe(true);
  });

  it('should classify 429 errors as rate limit', () => {
    expect(classifyError(new Error('HTTP 429 Too Many Requests')).category).toBe('rate_limit');
  });

  it('should classify server errors', () => {
    expect(classifyError(new Error('Internal Server Error')).category).toBe('server_error');
    expect(classifyError(new Error('HTTP 502 Bad Gateway')).category).toBe('server_error');
    expect(classifyError(new Error('HTTP 503 Service Unavailable')).category).toBe('server_error');
  });

  it('should classify overloaded errors', () => {
    expect(classifyError(new Error('Server overloaded')).category).toBe('overloaded');
  });

  it('should classify network errors', () => {
    expect(classifyError(new Error('ECONNREFUSED')).category).toBe('network');
    expect(classifyError(new Error('fetch failed')).category).toBe('network');
    expect(classifyError(new Error('socket hang up')).category).toBe('network');
  });

  it('should classify timeout errors', () => {
    expect(classifyError(new Error('Request timed out')).category).toBe('timeout');
    expect(classifyError(new Error('Connection timeout')).category).toBe('timeout');
  });

  it('should classify auth errors as non-retryable', () => {
    const result = classifyError(new Error('HTTP 401 Unauthorized'));
    expect(result.category).toBe('auth');
    expect(result.retryable).toBe(false);
  });

  it('should classify 403 errors as auth', () => {
    expect(classifyError(new Error('HTTP 403 Forbidden')).category).toBe('auth');
  });

  it('should classify invalid request as non-retryable', () => {
    const result = classifyError(new Error('HTTP 400 Bad Request'));
    expect(result.category).toBe('invalid_request');
    expect(result.retryable).toBe(false);
  });

  it('should classify context overflow as non-retryable', () => {
    const result = classifyError(new Error('prompt too long'));
    expect(result.category).toBe('context_too_large');
    expect(result.retryable).toBe(false);
  });

  it('should classify AbortError', () => {
    const err = Object.assign(new Error('User cancelled'), { name: 'AbortError' });
    const result = classifyError(err);
    expect(result.category).toBe('aborted');
    expect(result.retryable).toBe(false);
  });

  it('should classify unknown errors as non-retryable', () => {
    const result = classifyError(new Error('Something weird happened'));
    expect(result.category).toBe('unknown');
    expect(result.retryable).toBe(false);
  });

  it('should handle case-insensitive matching', () => {
    expect(classifyError(new Error('RATE LIMIT REACHED')).category).toBe('rate_limit');
    expect(classifyError(new Error('Authentication Failed')).category).toBe('auth');
  });
});

describe('computeBackoff', () => {
  const config: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30_000,
    retryableCategories: new Set(['rate_limit', 'server_error']),
  };

  it('should compute exponential backoff', () => {
    const delay0 = computeBackoff(0, config);
    const delay1 = computeBackoff(1, config);
    const delay2 = computeBackoff(2, config);

    expect(delay1).toBeGreaterThanOrEqual(delay0);
    expect(delay2).toBeGreaterThan(delay1);
  });

  it('should not exceed max delay', () => {
    const delay = computeBackoff(10, config);
    expect(delay).toBeLessThanOrEqual(config.maxDelayMs + config.baseDelayMs * 0.5);
  });
});

describe('Custom error classes', () => {
  it('MaxTurnsExceededError should include maxTurns', () => {
    const err = new MaxTurnsExceededError(20);
    expect(err.name).toBe('MaxTurnsExceededError');
    expect(err.maxTurns).toBe(20);
    expect(err.message).toContain('20');
  });

  it('BudgetExceededError should include totalCost', () => {
    const err = new BudgetExceededError(12.50);
    expect(err.name).toBe('BudgetExceededError');
    expect(err.totalCost).toBe(12.50);
    expect(err.message).toContain('$12.50');
  });

  it('StopRequestedError should include reason', () => {
    const err = new StopRequestedError('user interrupt');
    expect(err.name).toBe('StopRequestedError');
    expect(err.reason).toBe('user interrupt');
  });

  it('FatalAPIError should include category', () => {
    const err = new FatalAPIError('fatal', 'auth');
    expect(err.name).toBe('FatalAPIError');
    expect(err.category).toBe('auth');
  });

  it('ContextOverflowError should include ratio', () => {
    const err = new ContextOverflowError(0.85);
    expect(err.name).toBe('ContextOverflowError');
    expect(err.ratio).toBe(0.85);
  });
});
