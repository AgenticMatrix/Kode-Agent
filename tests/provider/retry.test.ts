import { describe, expect, it } from 'vitest';
import { classifyError, calculateDelay } from '../../src/provider/retry.js';

describe('classifyError (provider)', () => {
  it('should classify rate limit', () => {
    const result = classifyError(new Error('Rate limit exceeded 429'));
    expect(result.class).toBe('rate_limit');
    expect(result.retryable).toBe(true);
  });

  it('should classify auth errors', () => {
    expect(classifyError(new Error('HTTP 401 Unauthorized')).class).toBe('auth');
    expect(classifyError(new Error('Invalid API key')).class).toBe('auth');
  });

  it('should classify bad request', () => {
    const result = classifyError(new Error('HTTP 400 Bad Request'));
    expect(result.class).toBe('bad_request');
    expect(result.retryable).toBe(false);
  });

  it('should classify server errors', () => {
    expect(classifyError(new Error('HTTP 503 Service Unavailable')).class).toBe('server_error');
    expect(classifyError(new Error('Internal Server Error')).class).toBe('server_error');
  });

  it('should classify overloaded', () => {
    const result = classifyError(new Error('Server overloaded 529'));
    expect(result.class).toBe('overloaded');
    expect(result.retryable).toBe(true);
  });

  it('should classify network errors', () => {
    expect(classifyError(new Error('ECONNREFUSED')).class).toBe('network');
    expect(classifyError(new Error('fetch failed')).class).toBe('network');
    expect(classifyError(new Error('connection reset')).class).toBe('network');
  });

  it('should classify AbortError as non-retryable', () => {
    const err = Object.assign(new Error('cancelled'), { constructor: { name: 'AbortError' } });
    const result = classifyError(err);
    expect(result.class).toBe('unknown');
    expect(result.retryable).toBe(false);
  });

  it('should handle non-Error input', () => {
    const result = classifyError('something went wrong');
    expect(result.class).toBe('unknown');
    expect(result.retryable).toBe(false);
  });
});

describe('calculateDelay', () => {
  const baseConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30_000,
    jitter: 0.2,
    classifyError: classifyError,
    onRetry: () => {},
  } as const;

  it('should increase with attempt', () => {
    const d0 = calculateDelay(0, baseConfig);
    const d2 = calculateDelay(2, baseConfig);
    expect(d2).toBeGreaterThan(d0);
  });

  it('should not exceed max delay', () => {
    const delay = calculateDelay(10, baseConfig);
    expect(delay).toBeLessThanOrEqual(baseConfig.maxDelayMs + baseConfig.baseDelayMs * 0.2);
  });
});
