import { describe, expect, it } from 'vitest';
import { estimateTokens, estimateStringTokens, createTokenBudget, isBudgetExceeded, needsCompaction } from '../../src/core/token-budget.js';
import type { Message } from '../../src/core/types.js';

describe('estimateStringTokens', () => {
  it('should estimate text tokens', () => {
    const tokens = estimateStringTokens('hello world', 'text');
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThanOrEqual(10);
  });

  it('should return 0 for empty string', () => {
    expect(estimateStringTokens('', 'text')).toBe(0);
  });

  it('should estimate json tokens denser than text', () => {
    const text = '{"key":"value"}';
    const jsonTokens = estimateStringTokens(text, 'json');
    const textTokens = estimateStringTokens(text, 'text');
    // JSON should have higher ratio (more tokens per char)
    expect(jsonTokens).toBeGreaterThanOrEqual(textTokens);
  });

  it('should estimate code tokens densest', () => {
    const code = 'const x = 1;';
    const codeTokens = estimateStringTokens(code, 'code');
    const textTokens = estimateStringTokens(code, 'text');
    expect(codeTokens).toBeGreaterThanOrEqual(textTokens);
  });
});

describe('estimateTokens', () => {
  it('should estimate tokens for a message array', () => {
    const msgs: Message[] = [
      {
        role: 'user', id: 1, timestamp: 0,
        blocks: [{ type: 'text', text: 'Hello, how are you?' }],
        content: 'Hello, how are you?',
      },
    ];
    const total = estimateTokens(msgs);
    expect(total).toBeGreaterThan(0);
  });

  it('should include 2% buffer', () => {
    const msgs: Message[] = [
      {
        role: 'user', id: 1, timestamp: 0,
        blocks: [{ type: 'text', text: 'Hi' }],
        content: 'Hi',
      },
    ];
    const rawTokens = Math.ceil('Hi'.length / 3.5) + 4;
    const total = estimateTokens(msgs);
    expect(total).toBe(Math.ceil(rawTokens * 1.02));
  });

  it('should handle empty messages', () => {
    expect(estimateTokens([])).toBe(0);
  });

  it('should estimate tool_use blocks', () => {
    const msgs: Message[] = [
      {
        role: 'assistant', id: 1, timestamp: 0,
        blocks: [],
        content: [{ type: 'tool_use', toolName: 'Read', toolId: '1', input: { path: '/tmp' } }],
        thinking: undefined,
      },
    ];
    const total = estimateTokens(msgs);
    expect(total).toBeGreaterThan(0);
  });
});

describe('createTokenBudget', () => {
  it('should create budget with current and max', () => {
    const msgs: Message[] = [
      {
        role: 'user', id: 1, timestamp: 0,
        blocks: [{ type: 'text', text: 'Hello' }],
        content: 'Hello',
      },
    ];
    const budget = createTokenBudget(msgs, 100_000);
    expect(budget.current).toBeGreaterThan(0);
    expect(budget.max).toBe(100_000);
    expect(budget.ratio).toBeGreaterThan(0);
    expect(budget.ratio).toBeLessThan(1);
  });

  it('should clamp percent to 100', () => {
    const msgs: Message[] = [
      {
        role: 'user', id: 1, timestamp: 0,
        blocks: [{ type: 'text', text: 'x'.repeat(500_000) }],
        content: 'x'.repeat(500_000),
      },
    ];
    const budget = createTokenBudget(msgs, 1000);
    expect(budget.percent).toBe(100);
  });
});

describe('isBudgetExceeded', () => {
  it('should return true when ratio >= 1', () => {
    expect(isBudgetExceeded({ current: 100, max: 100, ratio: 1, percent: 100 })).toBe(true);
    expect(isBudgetExceeded({ current: 50, max: 100, ratio: 0.5, percent: 50 })).toBe(false);
  });
});

describe('needsCompaction', () => {
  it('should return true above threshold', () => {
    const budget = { current: 70, max: 100, ratio: 0.7, percent: 70 };
    expect(needsCompaction(budget, 0.6)).toBe(true);
    expect(needsCompaction(budget, 0.8)).toBe(false);
  });
});
