import { describe, expect, it, beforeEach } from 'vitest';
import {
  Compactor,
  DEFAULT_COMPACTOR_CONFIG,
} from '../context/compactor.js';
import type { Message } from '@kode/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUserMessage(content: string): Message {
  return { role: 'user', content };
}

function makeAssistantMessage(content: string): Message {
  return { role: 'assistant', content };
}

function makeSystemMessage(content: string): Message {
  return { role: 'system', content };
}

function makeMessages(count: number): Message[] {
  const msgs: Message[] = [];
  for (let i = 0; i < count; i++) {
    msgs.push(makeUserMessage(`Question ${i + 1}: ` + 'hello '.repeat(20)));
    msgs.push(makeAssistantMessage(`Answer ${i + 1}: ` + 'world '.repeat(30)));
  }
  return msgs;
}

// Helper to estimate total chars in messages
function estimateChars(msgs: Message[]): number {
  let total = 0;
  for (const m of msgs) {
    total += typeof m.content === 'string' ? m.content.length : 100;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Compactor', () => {
  let compactor: Compactor;

  beforeEach(() => {
    // Use a compactor with small thresholds and character-based estimation
    compactor = new Compactor({
      thresholds: { safe: 0.3, snip: 0.5, summarize: 0.8, overflow: 0.95 },
      maxTurnsToKeep: 5,
      minMessagesToKeep: 4,
      estimateTokens: estimateChars,
      summarizeEnabled: false,
    });
  });

  describe('DEFAULT_COMPACTOR_CONFIG', () => {
    it('should have expected defaults', () => {
      expect(DEFAULT_COMPACTOR_CONFIG.thresholds.safe).toBe(0.4);
      expect(DEFAULT_COMPACTOR_CONFIG.thresholds.snip).toBe(0.6);
      expect(DEFAULT_COMPACTOR_CONFIG.maxTurnsToKeep).toBe(15);
      expect(DEFAULT_COMPACTOR_CONFIG.summarizeEnabled).toBe(true);
    });
  });

  describe('computeBudget', () => {
    it('should compute token budget from messages', () => {
      const msgs = makeMessages(5);
      const budget = compactor.computeBudget(msgs, 10000);
      expect(budget.current).toBeGreaterThan(0);
      expect(budget.max).toBe(10000);
      expect(budget.ratio).toBeGreaterThan(0);
    });

    it('should return ratio 0 for empty messages', () => {
      const budget = compactor.computeBudget([], 10000);
      expect(budget.current).toBe(0);
      expect(budget.ratio).toBe(0);
    });

    it('should handle max budget of 0', () => {
      const budget = compactor.computeBudget(makeMessages(1), 0);
      expect(budget.ratio).toBe(0);
    });
  });

  describe('selectStrategy', () => {
    it('should return none when under safe threshold', () => {
      const strategy = compactor.selectStrategy({ current: 200, max: 1000, ratio: 0.2 });
      expect(strategy).toBe('none');
    });

    it('should return snip when over safe but under snip threshold', () => {
      const strategy = compactor.selectStrategy({ current: 400, max: 1000, ratio: 0.4 });
      expect(strategy).toBe('snip');
    });

    it('should return snip when summarize disabled (over snip threshold)', () => {
      const strategy = compactor.selectStrategy({ current: 700, max: 1000, ratio: 0.7 });
      expect(strategy).toBe('snip');
    });

    it('should return snip when near overflow (below overflow)', () => {
      const strategy = compactor.selectStrategy({ current: 900, max: 1000, ratio: 0.9 });
      expect(strategy).toBe('snip');
    });

    it('should return error when over overflow threshold', () => {
      const strategy = compactor.selectStrategy({ current: 980, max: 1000, ratio: 0.98 });
      expect(strategy).toBe('error');
    });
  });

  describe('needsCompaction', () => {
    it('should return false when under safe threshold', () => {
      const msgs = makeMessages(1);
      const needs = compactor.needsCompaction(msgs, 100000);
      expect(needs).toBe(false);
    });

    it('should return true when over safe threshold', () => {
      const msgs = makeMessages(20);
      const needs = compactor.needsCompaction(msgs, 2000);
      expect(needs).toBe(true);
    });
  });

  describe('compact', () => {
    it('should return unchanged messages when none strategy', async () => {
      const msgs = makeMessages(2);
      const result = await compactor.compact(msgs, 100000);
      expect(result.strategy).toBe('none');
      expect(result.messagesRemoved).toBe(0);
      expect(result.beforeTokens).toBe(result.afterTokens);
    });

    it('should snip oldest messages when over budget', async () => {
      // makeMessages(20) creates 40 messages (~6400 chars)
      // With budget 12000: ratio = 6400/12000 ≈ 0.533 (between snip 0.5 and summarize 0.8) → 'snip'
      const msgs = makeMessages(20);
      const result = await compactor.compact(msgs, 12000);
      expect(result.strategy).toBe('snip');
      expect(result.messagesRemoved).toBeGreaterThan(0);
      expect(result.afterTokens).toBeLessThan(result.beforeTokens);
    });

    it('should preserve system messages during snip', async () => {
      const sysMsg = makeSystemMessage('Important system context');
      const msgs = [sysMsg, ...makeMessages(20)];
      const result = await compactor.compact(msgs, 12000);
      const systemMsgs = result.messages.filter((m) => m.role === 'system');
      expect(systemMsgs.length).toBeGreaterThanOrEqual(1);
    });

    it('should insert boundary note when snipping', async () => {
      const msgs = makeMessages(20);
      const result = await compactor.compact(msgs, 12000);
      const hasBoundaryNote = result.messages.some(
        (m) => m.role === 'system' && typeof m.content === 'string' && m.content.includes('Context compacted'),
      );
      expect(hasBoundaryNote).toBe(true);
    });
  });

  describe('reset and accessors', () => {
    it('should track strategy after compact', async () => {
      const msgs = makeMessages(20);
      await compactor.compact(msgs, 12000);
      expect(compactor.getLastStrategy()).toBe('snip');
    });

    it('should increment compaction count', async () => {
      const msgs = makeMessages(20);
      await compactor.compact(msgs, 12000);
      expect(compactor.getCompactionCount()).toBe(1);
    });

    it('should reset state', async () => {
      const msgs = makeMessages(20);
      await compactor.compact(msgs, 12000);
      compactor.reset();
      expect(compactor.getLastStrategy()).toBe('none');
      expect(compactor.getCompactionCount()).toBe(0);
    });

    it('should return accumulated summary', () => {
      expect(compactor.getAccumulatedSummary()).toBe('');
    });

    it('should return config', () => {
      const config = compactor.getConfig();
      expect(config.thresholds.safe).toBe(0.3);
      expect(config.maxTurnsToKeep).toBe(5);
    });
  });

  describe('with summarize enabled', () => {
    it('should fall back to snip when no summarizeModel configured', async () => {
      const c = new Compactor({
        thresholds: { safe: 0.3, snip: 0.5, summarize: 0.8, overflow: 0.95 },
        maxTurnsToKeep: 5,
        minMessagesToKeep: 4,
        estimateTokens: estimateChars,
        summarizeEnabled: true,
        // No summarizeModel configured — selectStrategy returns 'summarize'
        // but compact() falls back to snip internally
      });
      const msgs = makeMessages(20);
      const result = await c.compact(msgs, 12000);
      // Falls back to snip since no summarizeModel
      expect(result.strategy).toBe('snip');
      expect(result.messagesRemoved).toBeGreaterThan(0);
    });
  });
});
