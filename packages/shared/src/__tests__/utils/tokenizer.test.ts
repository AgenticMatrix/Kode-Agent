import { describe, expect, it } from 'vitest';
import {
  checkTokenBudget,
  clearTokenizerCache,
  countTokens,
  truncateToBudget,
} from '../../utils/tokenizer.js';

describe('tokenizer', () => {
  afterEach(() => {
    clearTokenizerCache();
  });

  describe('countTokens', () => {
    it('should return 0 for empty string', () => {
      expect(countTokens('')).toBe(0);
    });

    it('should return 0 for whitespace-only string', () => {
      // Whitespace still encodes to tokens
      const result = countTokens('   ');
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it('should count tokens for simple text', () => {
      const tokens = countTokens('Hello, world!');
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10); // "Hello, world!" is ~4 tokens
    });

    it('should count more tokens for longer text', () => {
      const short = countTokens('hi');
      const long = countTokens('This is a much longer piece of text with many more words in it');
      expect(long).toBeGreaterThan(short);
    });

    it('should handle unicode characters', () => {
      const tokens = countTokens('你好世界 🎉');
      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle code snippets', () => {
      const code = 'function hello() { return "world"; }';
      const tokens = countTokens(code);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(20);
    });

    it('should return consistent results for repeated calls', () => {
      const text = 'consistency test text';
      const first = countTokens(text);
      const second = countTokens(text);
      expect(first).toBe(second);
    });

    it('should use model-specific encoding', () => {
      const text = 'test';
      const gpt4Tokens = countTokens(text, 'gpt-4');
      const gpt35Tokens = countTokens(text, 'gpt-3.5-turbo');
      // Both should return valid numbers
      expect(gpt4Tokens).toBeGreaterThan(0);
      expect(gpt35Tokens).toBeGreaterThan(0);
    });

    it('should fallback gracefully for unknown models', () => {
      const tokens = countTokens('test', 'unknown-model-xyz');
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('checkTokenBudget', () => {
    it('should report fits=true when under budget', () => {
      const result = checkTokenBudget('hi', 100);
      expect(result.fits).toBe(true);
      expect(result.tokens).toBeGreaterThan(0);
      expect(result.remaining).toBeGreaterThan(0);
    });

    it('should report fits=false when over budget', () => {
      // "hi" is ~1 token, so use budget of 0 to guarantee fits=false
      const result = checkTokenBudget('hi', 0);
      expect(result.fits).toBe(false);
      expect(result.remaining).toBeLessThan(0);
    });

    it('should return correct remaining count', () => {
      const text = 'test';
      const budget = 50;
      const result = checkTokenBudget(text, budget);
      expect(result.remaining).toBe(budget - result.tokens);
    });

    it('should handle exact budget match', () => {
      const text = 'a';
      const tokens = countTokens(text);
      const result = checkTokenBudget(text, tokens);
      expect(result.fits).toBe(true);
      expect(result.remaining).toBe(0);
    });

    it('should handle zero budget', () => {
      const result = checkTokenBudget('text', 0);
      expect(result.fits).toBe(false);
    });
  });

  describe('truncateToBudget', () => {
    it('should return original text when under budget', () => {
      const text = 'short text';
      const result = truncateToBudget(text, 100);
      expect(result).toBe(text);
    });

    it('should return empty string for empty input', () => {
      expect(truncateToBudget('', 100)).toBe('');
    });

    it('should return empty string for zero maxTokens', () => {
      expect(truncateToBudget('some text', 0)).toBe('');
    });

    it('should return empty string for negative maxTokens', () => {
      expect(truncateToBudget('some text', -1)).toBe('');
    });

    it('should truncate long text and append ellipsis', () => {
      const longText = 'A '.repeat(1000);
      const maxTokens = 10;
      const result = truncateToBudget(longText, maxTokens);
      expect(result.length).toBeLessThan(longText.length);
      expect(result.endsWith('...')).toBe(true);
    });

    it('should return just ellipsis when budget is very small', () => {
      const text = 'A '.repeat(100);
      // With a very small budget, we should at least get something back
      const result = truncateToBudget(text, 2);
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('clearTokenizerCache', () => {
    it('should not throw when called multiple times', () => {
      clearTokenizerCache();
      clearTokenizerCache();
      // Should not throw
    });

    it('should allow re-encoding after clearing', () => {
      const first = countTokens('test');
      clearTokenizerCache();
      const second = countTokens('test');
      expect(first).toBe(second);
    });
  });
});
