/**
 * compactor.ts — Context compaction with dual strategy (Snip + Summarize)
 *
 * Manages context window pressure by compacting message history when the
 * token budget threshold is exceeded.
 *
 * Strategies:
 *   - "none": No compaction needed (pressure < 40%)
 *   - "snip": Drop oldest messages, keep system context + recent N messages
 *   - "summarize": Use LLM to generate a conversation summary (replaces history)
 *   - "error": Context overflow — cannot compact further
 *
 * Architecture reference: ARCHITECTURE.md §4.5
 */

import type { Message, ContentBlock, StreamEvent } from '@kode/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompactStrategy = 'none' | 'snip' | 'summarize' | 'error';

// ---------------------------------------------------------------------------
// Microcompact types (zero-LLM lightweight cleanup)
// ---------------------------------------------------------------------------

export type MicrocompactStrategy = 'none' | 'time_based' | 'cache_edit';

export interface MicrocompactResult {
  messages: Message[];
  removedCount: number;
  savedTokens: number;
  strategy: MicrocompactStrategy;
}

/** Idle threshold for time-based microcompact: 60 minutes */
export const MICROCOMPACT_IDLE_THRESHOLD_MS = 60 * 60 * 1000;

/** Number of recent tool-result turns to keep during cleanup */
export const MICROCOMPACT_KEEP_RECENT_TOOL_TURNS = 3;

export interface TokenBudget {
  /** Current estimated token count */
  current: number;
  /** Maximum allowed tokens (context window budget) */
  max: number;
  /** Ratio of current / max (0–1) */
  ratio: number;
}

export interface CompactorConfig {
  /** Token thresholds for strategy selection */
  thresholds: {
    /** Below this ratio → "none" strategy (default: 0.4) */
    safe: number;
    /** Below this ratio → "snip" strategy (default: 0.6) */
    snip: number;
    /** Below this ratio → "summarize" strategy (default: 0.85) */
    summarize: number;
    /** Above this ratio → "error" (cannot compact further, default: 0.95) */
    overflow: number;
  };
  /** Maximum number of turns to keep when snipping */
  maxTurnsToKeep: number;
  /** Minimum number of messages to keep (system prompt + recent) */
  minMessagesToKeep: number;
  /** Function to estimate tokens in a message array */
  estimateTokens: (messages: Message[]) => number;
  /** Function to call the LLM for summarization */
  summarizeModel?: (params: { system: string; messages: Message[]; tools: unknown[]; signal: AbortSignal }) => AsyncGenerator<StreamEvent | { role: 'assistant'; content: ContentBlock[] }>;
  /** System prompt to prepend to summaries */
  systemPromptForSummary?: string;
  /** Whether summarization is enabled (false → always use snip) */
  summarizeEnabled: boolean;
  /**
   * Optional PreCompact hook callback.
   * Called before compaction starts. Receives the pre-compaction context.
   * Returned `injectContext` is inserted as a system message before the
   * compacted messages.
   */
  onPreCompact?: (ctx: {
    messageCount: number;
    currentTokens: number;
    budgetTokens: number;
    strategy: CompactStrategy;
  }) => Promise<{ injectContext: string }>;
}

export interface CompactResult {
  /** Strategy that was used */
  strategy: CompactStrategy;
  /** Token count before compaction */
  beforeTokens: number;
  /** Token count after compaction */
  afterTokens: number;
  /** The compacted message array */
  messages: Message[];
  /** Summary text (only set for "summarize" strategy) */
  summary?: string;
  /** Number of messages dropped or summarized */
  messagesRemoved: number;
}

export const DEFAULT_COMPACTOR_CONFIG: CompactorConfig = {
  thresholds: {
    safe: 0.4,
    snip: 0.6,
    summarize: 0.85,
    overflow: 0.95,
  },
  maxTurnsToKeep: 15,
  minMessagesToKeep: 10,
  estimateTokens: defaultEstimateTokens,
  summarizeEnabled: true,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Default token estimation: roughly ~3.5 characters per token.
 */
function defaultEstimateTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += Math.ceil(msg.content.length / 3.5);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        const text =
          block.text ??
          block.content ??
          (block.input ? JSON.stringify(block.input) : '');
        total += Math.ceil(String(text).length / 3.5);
      }
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Compactor
// ---------------------------------------------------------------------------

export class Compactor {
  private config: CompactorConfig;
  private lastStrategy: CompactStrategy = 'none';
  private compactionCount: number = 0;
  private accumulatedSummary: string = '';

  constructor(config?: Partial<CompactorConfig>) {
    this.config = { ...DEFAULT_COMPACTOR_CONFIG, ...config };
  }

  /**
   * Compute the current token budget from a message array.
   */
  computeBudget(messages: Message[], contextBudget: number): TokenBudget {
    const current = this.config.estimateTokens(messages);
    return {
      current,
      max: contextBudget,
      ratio: contextBudget > 0 ? current / contextBudget : 0,
    };
  }

  /**
   * Determine which compaction strategy to use based on the token budget ratio.
   */
  selectStrategy(budget: TokenBudget): CompactStrategy {
    const { thresholds } = this.config;

    if (budget.ratio <= thresholds.safe) {
      return 'none';
    }
    if (budget.ratio <= thresholds.snip) {
      return 'snip';
    }
    if (budget.ratio <= thresholds.summarize) {
      return this.config.summarizeEnabled ? 'summarize' : 'snip';
    }
    if (budget.ratio <= thresholds.overflow) {
      // Already at critical levels — try aggressive snip first
      return 'snip';
    }
    return 'error';
  }

  /**
   * Compact a message array to fit within the context budget.
   *
   * Entry point — selects the right strategy and returns compacted messages.
   */
  async compact(
    messages: Message[],
    contextBudget: number,
  ): Promise<CompactResult> {
    const budget = this.computeBudget(messages, contextBudget);
    const strategy = this.selectStrategy(budget);

    this.lastStrategy = strategy;

    // === PreCompact hook ===
    let injectContext = '';
    if (this.config.onPreCompact) {
      try {
        const hookResult = await this.config.onPreCompact({
          messageCount: messages.length,
          currentTokens: budget.current,
          budgetTokens: budget.max,
          strategy,
        });
        injectContext = hookResult.injectContext;
      } catch {
        // Hook errors are non-fatal during compaction
      }
    }

    // If hook injected context, add it as a system message before compacting
    if (injectContext) {
      const hookMsg: Message = {
        role: 'system',
        content: `[PreCompact hook context]\n${injectContext}`,
      };
      messages = [hookMsg, ...messages];
    }

    switch (strategy) {
      case 'none':
        return {
          strategy: 'none',
          beforeTokens: budget.current,
          afterTokens: budget.current,
          messages,
          messagesRemoved: 0,
        };

      case 'snip':
        return this.snip(messages, budget);

      case 'summarize':
        return this.summarize(messages, budget);

      case 'error':
        return {
          strategy: 'error',
          beforeTokens: budget.current,
          afterTokens: budget.current,
          messages,
          messagesRemoved: 0,
        };
    }
  }

  /**
   * Check if compaction is needed for the given messages.
   */
  needsCompaction(messages: Message[], contextBudget: number): boolean {
    const budget = this.computeBudget(messages, contextBudget);
    return budget.ratio > this.config.thresholds.safe;
  }

  // -----------------------------------------------------------------------
  // Microcompact — zero-LLM, zero-cost lightweight context cleanup
  // -----------------------------------------------------------------------

  /**
   * Microcompact: zero-LLM-call, zero-cost lightweight context cleanup.
   *
   * Two sub-strategies that run before full-scale compaction:
   *
   * **A: Time-Based Cleanup** — When idle > 60min:
   *   - Clear old tool_result blocks (preserve last 3 turns)
   *   - Clear system messages before the last compact_boundary
   *
   * **B: Cache Edit** — Leverage prompt caching:
   *   - Identify cacheable prefix (system prompt + tools definitions)
   *   - Strip stale tool_result blocks before the cache boundary
   *   - Mark cacheable messages for the callModel caller
   *
   * Returns the cleaned messages (may be unchanged if no cleanup performed).
   *
   * @param messages              — current message array
   * @param lastInteractionTime   — timestamp (ms) of last user interaction
   * @param cacheablePrefixTokens — estimated token count of cacheable prefix
   */
  async microcompact(
    messages: Message[],
    lastInteractionTime: number,
    cacheablePrefixTokens?: number,
  ): Promise<MicrocompactResult> {
    const now = Date.now();
    const beforeTokens = this.config.estimateTokens(messages);

    // ── Strategy A: Time-based cleanup (idle > 60min) ─────────────────
    if (now - lastInteractionTime > MICROCOMPACT_IDLE_THRESHOLD_MS) {
      return this.microcompactTimeBased(messages, beforeTokens);
    }

    // ── Strategy B: Cache edit ────────────────────────────────────────
    if (cacheablePrefixTokens && cacheablePrefixTokens > 0) {
      return this.microcompactCacheEdit(messages, beforeTokens, cacheablePrefixTokens);
    }

    return {
      messages,
      removedCount: 0,
      savedTokens: 0,
      strategy: 'none',
    };
  }

  // -----------------------------------------------------------------------
  // Microcompact Strategy A: Time-Based Cleanup
  // -----------------------------------------------------------------------

  /**
   * Clean up old tool results and stale system messages when the session
   * has been idle for >60 minutes.
   *
   * Preservation rules:
   *   - Keep all non-tool-result, non-system messages unchanged
   *   - Keep tool_results from the most recent N turns (N=MICROCOMPACT_KEEP_RECENT_TOOL_TURNS)
   *   - Keep system messages AFTER the last compact_boundary
   *   - Remove older tool_results and pre-boundary system messages
   */
  private microcompactTimeBased(
    messages: Message[],
    beforeTokens: number,
  ): MicrocompactResult {
    const keepTurns = MICROCOMPACT_KEEP_RECENT_TOOL_TURNS;
    let removedCount = 0;

    // ── Find the last compact_boundary ──────────────────────────────
    let lastBoundaryIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg && msg.role === 'system' && typeof msg.content === 'string') {
        if (msg.content.includes('[compact_boundary]') || msg.content.includes('[Context compacted:')) {
          lastBoundaryIndex = i;
          break;
        }
      }
    }

    // ── Count turns from the end to find the cutoff ─────────────────
    let turnCount = 0;
    let keepFromIndex = messages.length - 1;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg && msg.role === 'assistant') {
        turnCount++;
      }
      // Include the user message that contains tool_results for this turn
      if (turnCount >= keepTurns) {
        // Search back to include the user message with tool results for this turn
        keepFromIndex = i;
        break;
      }
    }

    // ── Don't cross the compact_boundary ─────────────────────────────
    if (lastBoundaryIndex > keepFromIndex) {
      keepFromIndex = lastBoundaryIndex;
    }

    // ── Build cleaned message list ───────────────────────────────────
    const cleaned: Message[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;

      if (i < keepFromIndex) {
        // Check if this message is safe to remove
        if (msg.role === 'system' && i <= lastBoundaryIndex) {
          // Old system message before boundary — remove
          removedCount++;
          continue;
        }

        if (msg.role === 'user' && typeof msg.content !== 'string' && Array.isArray(msg.content)) {
          // This is likely a tool_result-bearing user message.
          // Check if ALL content blocks are tool_result — if so, and it's old, remove.
          const allToolResults = msg.content.every(
            (block) => block.type === 'tool_result',
          );
          if (allToolResults) {
            removedCount++;
            continue;
          }
        }
      }

      cleaned.push(msg);
    }

    // If nothing was removed, return as-is
    if (removedCount === 0) {
      return {
        messages,
        removedCount: 0,
        savedTokens: 0,
        strategy: 'none',
      };
    }

    const afterTokens = this.config.estimateTokens(cleaned);
    const savedTokens = Math.max(0, beforeTokens - afterTokens);

    // Insert a cleanup note at the keep boundary
    const cleanupNote: Message = {
      role: 'system',
      content: `[Microcompact: time-based cleanup — ${removedCount} old tool result and system messages removed after ${Math.round((Date.now() - (Date.now() - MICROCOMPACT_IDLE_THRESHOLD_MS - 1)) / 60000)}min idle period. Saved ~${savedTokens.toLocaleString()} tokens.]`,
    };
    // Insert after the last system message or at the beginning
    let insertAt = 0;
    for (let i = cleaned.length - 1; i >= 0; i--) {
      if (cleaned[i]!.role === 'system') {
        insertAt = i + 1;
        break;
      }
    }
    cleaned.splice(insertAt, 0, cleanupNote);

    return {
      messages: cleaned,
      removedCount,
      savedTokens,
      strategy: 'time_based',
    };
  }

  // -----------------------------------------------------------------------
  // Microcompact Strategy B: Cache Edit
  // -----------------------------------------------------------------------

  /**
   * Leverage prompt caching by removing stale tool_results that sit before
   * the cacheable prefix boundary.
   *
   * When the model's prompt cache covers the system prompt + tools definitions
   * (the "cacheable prefix"), tool_results before this boundary are already
   * cached and stale — removing them saves tokens without cache miss penalty.
   *
   * @param messages             — current message array
   * @param beforeTokens         — pre-computed token count
   * @param cacheablePrefixTokens — estimated tokens of cacheable prefix
   */
  private microcompactCacheEdit(
    messages: Message[],
    beforeTokens: number,
    cacheablePrefixTokens: number,
  ): MicrocompactResult {
    let removedCount = 0;
    let tokensScanned = 0;
    let cacheBoundaryIndex = -1;

    // ── Find the cache boundary ──────────────────────────────────────
    // Walk forward through messages, summing token estimates until we
    // reach the cacheablePrefixTokens threshold. The first message
    // beyond this boundary is where caching starts.
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      tokensScanned += this.config.estimateTokens([msg]);

      if (tokensScanned >= cacheablePrefixTokens) {
        cacheBoundaryIndex = i;
        break;
      }
    }

    // If no boundary found (all messages fit in cache prefix), nothing to do
    if (cacheBoundaryIndex < 0) {
      return {
        messages,
        removedCount: 0,
        savedTokens: 0,
        strategy: 'none',
      };
    }

    // ── Remove stale tool_results before the cache boundary ─────────
    // Strategy: for user messages containing ONLY tool_result blocks
    // that sit entirely before the cache boundary, remove them.
    // Mixed messages (text + tool_results) are preserved.
    const cleaned: Message[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;

      if (i < cacheBoundaryIndex &&
          msg.role === 'user' &&
          typeof msg.content !== 'string' &&
          Array.isArray(msg.content)) {
        const allToolResults = msg.content.every(
          (block) => block.type === 'tool_result',
        );
        if (allToolResults) {
          removedCount++;
          continue;
        }
      }

      cleaned.push(msg);
    }

    if (removedCount === 0) {
      return {
        messages,
        removedCount: 0,
        savedTokens: 0,
        strategy: 'none',
      };
    }

    const afterTokens = this.config.estimateTokens(cleaned);
    const savedTokens = Math.max(0, beforeTokens - afterTokens);

    return {
      messages: cleaned,
      removedCount,
      savedTokens,
      strategy: 'cache_edit',
    };
  }

  // -----------------------------------------------------------------------
  // Snip Strategy — drop oldest messages
  // -----------------------------------------------------------------------

  /**
   * Snip the oldest messages to reduce context size.
   *
   * Preserves:
   * - System-level messages (role: 'system')
   * - Most recent N messages (up to maxTurnsToKeep × 2 messages per turn)
   */
  private snip(messages: Message[], budget: TokenBudget): CompactResult {
    const { maxTurnsToKeep, minMessagesToKeep } = this.config;

    // Separate system messages from conversation messages
    const systemMessages = messages.filter((m) => m.role === 'system');
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    // Count turns in conversation (each assistant message = 1 turn)
    let turnCount = 0;
    let keepFromIndex = conversationMessages.length;

    for (let i = conversationMessages.length - 1; i >= 0; i--) {
      const msg = conversationMessages[i];
      if (msg && msg.role === 'assistant') {
        turnCount++;
      }
      if (turnCount >= maxTurnsToKeep) {
        keepFromIndex = i;
        break;
      }
    }

    // Don't drop below minimum
    const maxDrop = conversationMessages.length - minMessagesToKeep;
    if (keepFromIndex > maxDrop) {
      keepFromIndex = Math.max(0, maxDrop);
    }

    const keptConversation = conversationMessages.slice(keepFromIndex);
    const droppedCount = conversationMessages.length - keptConversation.length;

    // Construct boundary note if we dropped messages
    const compactedMessages: Message[] = [...systemMessages];

    if (droppedCount > 0) {
      const boundaryNote: Message = {
        role: 'system',
        content: `[Context compacted: ${droppedCount} earlier messages were trimmed to stay within the ${budget.max.toLocaleString()}-token budget. Key context from earlier in the conversation has been preserved.]`,
      };
      compactedMessages.push(boundaryNote);
      this.compactionCount++;
    }

    compactedMessages.push(...keptConversation);

    const afterTokens = this.config.estimateTokens(compactedMessages);

    return {
      strategy: 'snip',
      beforeTokens: budget.current,
      afterTokens,
      messages: compactedMessages,
      messagesRemoved: droppedCount,
    };
  }

  // -----------------------------------------------------------------------
  // Summarize Strategy — LLM-based conversation summarization
  // -----------------------------------------------------------------------

  /**
   * Summarize older messages using an LLM call, then concatenate with recent
   * messages. Falls back to "snip" if summarization is unavailable.
   */
  private async summarize(
    messages: Message[],
    budget: TokenBudget,
  ): Promise<CompactResult> {
    if (!this.config.summarizeModel) {
      // No summarization model available → fall back to snip
      return this.snip(messages, budget);
    }

    const systemMessages = messages.filter((m) => m.role === 'system');
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    // Split at midpoint: first half for summarization, second half kept as-is
    const midpoint = Math.floor(conversationMessages.length / 2);
    const toSummarize = conversationMessages.slice(0, midpoint);
    const recentMessages = conversationMessages.slice(midpoint);

    if (toSummarize.length === 0) {
      return this.snip(messages, budget);
    }

    try {
      const summary = await this.generateSummary(toSummarize);

      // Build new message array: system + accumulated summary + recent
      const compactedMessages: Message[] = [...systemMessages];

      // Add previous accumulated summary if any (compounding)
      if (this.accumulatedSummary) {
        compactedMessages.push({
          role: 'system',
          content: `## Previous Conversation Summary\n${this.accumulatedSummary}`,
        });
      }

      // Merge new summary into accumulated
      this.accumulatedSummary = this.mergeSummaries(
        this.accumulatedSummary,
        summary,
      );

      // Add latest summary
      compactedMessages.push({
        role: 'system',
        content: `## Conversation Summary (Compacted Turn)\n${summary}\n\n[${toSummarize.length} earlier messages have been summarized to conserve context. The most recent ${recentMessages.length} messages are preserved in full below.]`,
      });

      compactedMessages.push(...recentMessages);

      this.compactionCount++;

      const afterTokens = this.config.estimateTokens(compactedMessages);

      return {
        strategy: 'summarize',
        beforeTokens: budget.current,
        afterTokens,
        messages: compactedMessages,
        summary,
        messagesRemoved: toSummarize.length,
      };
    } catch {
      // Summarization failed → fall back to snip
      return this.snip(messages, budget);
    }
  }

  /**
   * Generate a summary of a set of messages using the LLM.
   */
  private async generateSummary(messages: Message[]): Promise<string> {
    if (!this.config.summarizeModel) {
      throw new Error('No summarizeModel configured');
    }

    const messagesText = this.messagesToText(messages);

    const summaryPrompt =
      this.config.systemPromptForSummary ??
      `You are a conversation summarizer. Create a structured, concise summary of the conversation below.

Focus on:
1. **Tasks and Requests**: What the user asked for
2. **Decisions Made**: Key technical choices and their rationale
3. **Files Modified**: Which files were changed and why
4. **Errors Encountered**: Problems that arose and their resolutions
5. **Pending Work**: What remains to be done

Keep the summary under 500 words. Use bullet points for clarity.`;

    const summaryMessages: Message[] = [
      {
        role: 'user',
        content: `Please summarize this conversation segment:\n\n${messagesText}`,
      },
    ];

    // Call the summarization model
    const stream = this.config.summarizeModel({
      system: summaryPrompt,
      messages: summaryMessages,
      tools: [],
      signal: new AbortController().signal,
    });

    let summary = '';
    for await (const event of stream) {
      if ('type' in event) {
        const streamEvent = event as StreamEvent;
        if (streamEvent.type === 'content_block_delta') {
          const delta = streamEvent.delta as { type: string; text?: string };
          if (delta.type === 'text_delta' && delta.text) {
            summary += delta.text;
          }
        }
      }
    }

    return summary || 'Summary generation produced no output.';
  }

  /**
   * Convert messages to a readable text format for summarization.
   */
  private messagesToText(messages: Message[]): string {
    const lines: string[] = [];

    for (const msg of messages) {
      const role = msg.role.toUpperCase();

      if (typeof msg.content === 'string') {
        lines.push(`[${role}]: ${msg.content.slice(0, 500)}`);
        if (msg.content.length > 500) {
          lines.push('  ... (truncated)');
        }
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          switch (block.type) {
            case 'text':
              lines.push(
                `[${role} / text]: ${(block.text ?? '').slice(0, 300)}`,
              );
              break;
            case 'tool_use':
              lines.push(
                `[${role} / tool_use]: ${block.name}(${block.input ? JSON.stringify(block.input).slice(0, 200) : ''})`,
              );
              break;
            case 'tool_result':
              if (block.is_error) {
                lines.push(
                  `[${role} / tool_result error]: ${String(block.content ?? '').slice(0, 200)}`,
                );
              } else {
                lines.push(
                  `[${role} / tool_result]: ${String(block.content ?? '').slice(0, 200)}`,
                );
              }
              break;
            case 'thinking':
              lines.push(`[${role} / thinking]: (omitted)`);
              break;
            default:
              break;
          }
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Merge a new summary into the accumulated summary.
   * Preserves key information while keeping the combined summary concise.
   */
  private mergeSummaries(existing: string, newSummary: string): string {
    if (!existing) return newSummary;

    // Simple merge: append new summary to existing, with a separator
    const existingWords = existing.split(/\s+/).length;
    const newWords = newSummary.split(/\s+/).length;

    // If combined > 800 words, truncate the older summary
    if (existingWords + newWords > 800) {
      const existingLines = existing.split('\n');
      const truncated = existingLines.slice(
        0,
        Math.floor(existingLines.length * 0.4),
      );
      return `${truncated.join('\n')}\n\n---\n## More Recent\n${newSummary}`;
    }

    return `${existing}\n\n---\n## Update\n${newSummary}`;
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  /** Get the last compaction strategy used. */
  getLastStrategy(): CompactStrategy {
    return this.lastStrategy;
  }

  /** Get the number of times compaction has been triggered. */
  getCompactionCount(): number {
    return this.compactionCount;
  }

  /** Get the accumulated summary (across multiple compaction rounds). */
  getAccumulatedSummary(): string {
    return this.accumulatedSummary;
  }

  /** Reset the compactor state (for new sessions). */
  reset(): void {
    this.lastStrategy = 'none';
    this.compactionCount = 0;
    this.accumulatedSummary = '';
  }

  /** Get the current config (read-only). */
  getConfig(): Readonly<CompactorConfig> {
    return this.config;
  }
}
