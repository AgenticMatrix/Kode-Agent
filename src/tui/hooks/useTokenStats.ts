import { useMemo } from 'react';

import type { Message, TokenUsage } from '../../types.js';
import { getMessageText, getMessageThinking } from './useChatReducer.js';

export interface TokenStats {
  totalChars: number;
  inputTokens: number;
  outputTokens: number;
  /** Real token usage from latest API response (for ctx display). */
  realUsage: TokenUsage;
  /** Accumulated total cost across all turns. */
  accumulatedCost: number;
}

/**
 * Compute approximate token statistics from message history,
 * combined with real token usage from API responses.
 */
export function useTokenStats(messages: Message[], realUsage: TokenUsage, accumulatedCost: number): TokenStats {
  return useMemo(() => {
    const totalChars = messages.reduce((sum, m) => {
      const text = getMessageText(m);
      const thinking = getMessageThinking(m);
      return sum + text.length + (thinking?.length ?? 0);
    }, 0);

    const inputTokens = Math.ceil(
      messages
        .filter((m) => m.role === 'user')
        .reduce((sum, m) => sum + getMessageText(m).length, 0) / 4,
    );

    const outputTokens = Math.ceil(
      messages
        .filter((m) => m.role === 'assistant')
        .reduce((sum, m) => {
          const text = getMessageText(m);
          const thinking = getMessageThinking(m);
          return sum + text.length + (thinking?.length ?? 0);
        }, 0) / 4,
    );

    return { totalChars, inputTokens, outputTokens, realUsage, accumulatedCost };
  }, [messages, realUsage, accumulatedCost]);
}
