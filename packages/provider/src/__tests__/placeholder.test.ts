import { describe, expect, it } from 'vitest';
import {
  AnthropicProvider,
  calculateCost,
  classifyError,
  withRetry,
} from '../index.js';

describe('@kode/provider', () => {
  it('should export AnthropicProvider', () => {
    expect(AnthropicProvider).toBeDefined();
  });

  it('should export calculateCost', () => {
    expect(calculateCost).toBeDefined();
    expect(typeof calculateCost).toBe('function');
  });

  it('should export withRetry', () => {
    expect(withRetry).toBeDefined();
    expect(typeof withRetry).toBe('function');
  });

  it('should export classifyError', () => {
    expect(classifyError).toBeDefined();
    expect(typeof classifyError).toBe('function');
  });
});
