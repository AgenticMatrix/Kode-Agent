import { useMemo } from 'react';

import type { Message } from '../../types.js';
import { getMessageText, getMessageThinking } from './useChatReducer.js';

export interface TokenStats {
  totalChars: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Compute approximate token statistics from message history.
 * Tokens are roughly estimated at ~4 chars per token.
 */
export function useTokenStats(messages: Message[]): TokenStats {
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

    return { totalChars, inputTokens, outputTokens };
  }, [messages]);
}
