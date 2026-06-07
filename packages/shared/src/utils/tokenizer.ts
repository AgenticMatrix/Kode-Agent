/**
 * Token counting utility using tiktoken.
 *
 * Provides accurate token counting for Anthropic Claude and OpenAI models,
 * used for context budget management and cost estimation.
 */

import { encoding_for_model, type TiktokenModel } from 'tiktoken';

// ── Tokenizer cache ───────────────────────────────────────────────────────

const encoderCache = new Map<string, ReturnType<typeof encoding_for_model>>();

function getEncoder(model: string): ReturnType<typeof encoding_for_model> {
  const cached = encoderCache.get(model);
  if (cached) return cached;

  try {
    const encoder = encoding_for_model(model as TiktokenModel);
    encoderCache.set(model, encoder);
    return encoder;
  } catch {
    const encoder = encoding_for_model('gpt-4');
    encoderCache.set(model, encoder);
    return encoder;
  }
}

export function countTokens(text: string, model = 'gpt-4'): number {
  if (!text || text.length === 0) return 0;
  const encoder = getEncoder(model);
  return encoder.encode(text).length;
}

export function countMessageTokens(
  messages: Array<{ role: string; content: string }>,
  model = 'gpt-4',
): number {
  const MESSAGE_OVERHEAD = 3;
  let totalTokens = 0;
  for (const msg of messages) {
    const roleTokens = countTokens(msg.role, model);
    const contentTokens = typeof msg.content === 'string'
      ? countTokens(msg.content, model)
      : 0;
    totalTokens += roleTokens + contentTokens + MESSAGE_OVERHEAD;
  }
  return totalTokens;
}

export function checkTokenBudget(
  text: string,
  budget: number,
  model = 'gpt-4',
): { fits: boolean; tokens: number; remaining: number } {
  const tokens = countTokens(text, model);
  return {
    fits: tokens <= budget,
    tokens,
    remaining: budget - tokens,
  };
}

export function truncateToBudget(
  text: string,
  maxTokens: number,
  model = 'gpt-4',
): string {
  if (!text || maxTokens <= 0) return '';
  const totalTokens = countTokens(text, model);
  if (totalTokens <= maxTokens) return text;

  let low = 0;
  let high = text.length;

  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    const truncated = text.slice(0, mid) + '...';
    const tokens = countTokens(truncated, model);
    if (tokens <= maxTokens) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  if (low === 0) return '...';
  return text.slice(0, low) + '...';
}

export function clearTokenizerCache(): void {
  for (const encoder of encoderCache.values()) {
    encoder.free();
  }
  encoderCache.clear();
}
