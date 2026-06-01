/**
 * token-budget.ts — Token estimation utilities
 *
 * Provides a standalone, reusable token estimator for the Agent Loop's
 * context window management. Used by both query.ts (inline compaction
 * checks) and compactor.ts (strategy selection).
 *
 * Estimation method:
 *   Character-based with per-field weighting:
 *   - Plain text: ~3.5 chars/token (baseline for English prose)
 *   - JSON/structured fields: ~2.5 chars/token (denser token packing)
 *   - Code blocks: ~2.0 chars/token (code is more token-dense)
 *
 * This is heuristic, not exact. For precise token counts, use the
 * provider's tokenizer (e.g., tiktoken for OpenAI-compatible APIs).
 *
 * Architecture reference: ARCHITECTURE.md §4.5
 */

import type { Message, ContentBlock } from '@kode/shared';

// ---------------------------------------------------------------------------
// TokenBudget type (canonical definition)
// ---------------------------------------------------------------------------

export interface TokenBudget {
  /** Current estimated token count of the message array */
  current: number;
  /** Maximum allowed tokens for the context window */
  max: number;
  /** Ratio of current / max (0–1) */
  ratio: number;
  /** Percentage used (0–100), for display */
  percent: number;
}

// ---------------------------------------------------------------------------
// Token estimation weights
// ---------------------------------------------------------------------------

/**
 * Estimated characters per token for different content types.
 * Based on empirical observation of Claude's tokenizer behavior.
 */
const CHARS_PER_TOKEN = {
  /** Plain English prose text */
  text: 3.5,
  /** JSON strings, structured tool input/output */
  json: 2.5,
  /** Code blocks (source files, diffs, shell output) */
  code: 2.0,
  /** Default fallback */
  default: 3.0,
} as const;

// ---------------------------------------------------------------------------
// Token estimation functions
// ---------------------------------------------------------------------------

/**
 * Estimate token count for a plain string.
 */
export function estimateStringTokens(
  text: string,
  contentType: 'text' | 'json' | 'code' = 'text',
): number {
  if (!text) return 0;
  const divisor = CHARS_PER_TOKEN[contentType];
  return Math.ceil(text.length / divisor);
}

/**
 * Estimate token count for a ContentBlock.
 *
 * Weights per block type:
 *   - text: standard text rate
 *   - tool_use: json rate (structured input)
 *   - tool_result: code rate (tool output is often code/diff-like)
 *   - thinking: text rate
 *   - image: 85 tokens (rough estimate for small images)
 */
export function estimateBlockTokens(block: ContentBlock): number {
  switch (block.type) {
    case 'text': {
      const text = block.text ?? '';
      return estimateStringTokens(text, 'text');
    }

    case 'tool_use': {
      let total = 0;
      // Tool name + id overhead: ~10 tokens
      total += 10;
      // Input is structured JSON
      if (block.input) {
        total += estimateStringTokens(
          JSON.stringify(block.input),
          'json',
        );
      }
      return total;
    }

    case 'tool_result': {
      let total = 0;
      const content =
        typeof block.content === 'string'
          ? block.content
          : block.content
            ? JSON.stringify(block.content)
            : '';
      // Tool results are often code/diffs — use code rate
      total += estimateStringTokens(content, 'code');
      // Error flag overhead: ~5 tokens
      if (block.is_error) total += 5;
      return total;
    }

    case 'thinking': {
      const thinking = block.thinking ?? '';
      return estimateStringTokens(thinking, 'text');
    }

    case 'image': {
      // Image size varies, but 85 tokens is a reasonable default
      // for a small screenshot. Large images can use 200+ tokens.
      return block.source?.data
        ? Math.ceil(String(block.source.data).length / 50)
        : 85;
    }

    default:
      return 0;
  }
}

/**
 * Estimate token count for a single Message.
 *
 * Accounts for:
 *   - Role tag overhead (~4 tokens per message for API metadata)
 *   - Content blocks (weighted by type)
 *   - String content fallback
 */
export function estimateMessageTokens(message: Message): number {
  // Base overhead per message (role tag, formatting tokens)
  let tokens = 4;

  if (typeof message.content === 'string') {
    tokens += estimateStringTokens(message.content, 'text');
  } else if (Array.isArray(message.content)) {
    for (const block of message.content) {
      tokens += estimateBlockTokens(block);
    }
  }

  return tokens;
}

/**
 * Estimate total token count for an array of messages.
 *
 * This is the main entry point — used by query.ts and compactor.ts
 * to decide whether context compaction is needed.
 */
export function estimateTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateMessageTokens(msg);
  }
  // Add 2% buffer for inter-message formatting tokens
  return Math.ceil(total * 1.02);
}

// ---------------------------------------------------------------------------
// TokenBudget factory
// ---------------------------------------------------------------------------

/**
 * Create a TokenBudget from a message array and a maximum budget.
 *
 * Usage:
 *   const budget = createTokenBudget(messages, 180_000);
 *   if (budget.ratio > 0.6) { /* trigger compaction *\/ }
 */
export function createTokenBudget(
  messages: Message[],
  maxTokens: number,
): TokenBudget {
  const current = estimateTokens(messages);
  const safeMax = Math.max(1, maxTokens);
  return {
    current,
    max: maxTokens,
    ratio: current / safeMax,
    percent: Math.min(100, Math.round((current / safeMax) * 100)),
  };
}

/**
 * Create a budget with a pre-computed token count.
 */
export function createTokenBudgetFromCount(
  currentTokens: number,
  maxTokens: number,
): TokenBudget {
  const safeMax = Math.max(1, maxTokens);
  return {
    current: currentTokens,
    max: maxTokens,
    ratio: currentTokens / safeMax,
    percent: Math.min(100, Math.round((currentTokens / safeMax) * 100)),
  };
}

/**
 * Check whether the token budget has been exceeded.
 */
export function isBudgetExceeded(budget: TokenBudget): boolean {
  return budget.ratio >= 1;
}

/**
 * Check whether compaction is recommended (budget > safe threshold).
 */
export function needsCompaction(
  budget: TokenBudget,
  threshold = 0.6,
): boolean {
  return budget.ratio > threshold;
}
