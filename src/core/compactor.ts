/**
 * Compactor — Stub implementation. No compaction needed yet for ink-chat-tui.
 *
 * The compact() method always returns the messages unchanged.
 * This satisfies the interface expected by query.ts while deferring
 * real compaction to a later phase.
 */

import type { Message } from './types.js';

export interface CompactorConfig {
  estimateTokens: (messages: Message[]) => number;
  summarizeEnabled: boolean;
}

export class Compactor {
  private config: CompactorConfig;

  constructor(config: CompactorConfig) {
    this.config = config;
  }

  async microcompact(messages: Message[], _lastUserInteractionTime: number): Promise<{
    strategy: 'none' | 'time_based';
    removedCount: number;
    savedTokens: number;
    messages: Message[];
  }> {
    return { strategy: 'none', removedCount: 0, savedTokens: 0, messages };
  }
}
