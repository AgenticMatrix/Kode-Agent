/**
 * MemoryExtractor — Extract memories from session transcripts.
 *
 * Uses heuristic pattern matching to identify facts worth remembering:
 * - User preferences and corrections
 * - Project architecture decisions
 * - Recurring patterns and feedback
 *
 * Architecture reference: ARCHITECTURE.md §4.10
 */

import type { IMemoryStore } from './store.js';
import { extractKeywords } from './store.js';
import { MemoryType, type MemoryInput } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractionResult {
  /** Extracted memories (already deduplicated) */
  memories: MemoryInput[];
  /** Number of candidate facts evaluated */
  candidatesEvaluated: number;
  /** Number rejected by dedup check */
  duplicatesFound: number;
}

export interface ExtractionOptions {
  /** Session ID for source tracking */
  sessionId: string;
  /** Working directory */
  cwd?: string;
  /** Minimum confidence threshold for extraction (0-1) */
  minConfidence?: number;
  /** Skip dedup check (for testing) */
  skipDedup?: boolean;
}

// ---------------------------------------------------------------------------
// Extraction Patterns
// ---------------------------------------------------------------------------

interface ExtractionPattern {
  /** Regex to match in the transcript */
  regex: RegExp;
  /** Memory type to assign */
  type: MemoryType;
  /** Extract the memory content from regex match groups */
  extract: (match: RegExpMatchArray) => string | null;
  /** Importance score 0-1 */
  importance: number;
}

const EXTRACTION_PATTERNS: ExtractionPattern[] = [
  // ── User Preferences ─────────────────────────────────────────
  {
    regex: /(?:i prefer|i like|i want|use)\s+(.+?)(?:\.|$|\n)/gi,
    type: MemoryType.USER_PROFILE,
    extract: (m) => `User prefers: ${m[1]?.trim()}`,
    importance: 0.7,
  },
  {
    regex: /(?:my|our)\s+(?:convention|style|pattern|standard)\s+(?:is|:)\s+(.+?)(?:\.|$|\n)/gi,
    type: MemoryType.USER_PROFILE,
    extract: (m) => `Coding convention: ${m[1]?.trim()}`,
    importance: 0.8,
  },
  {
    regex: /(?:actually|no,?\s)(?:let'?s|use|do|try)\s+(.+?)(?:instead)?(?:\.|$|\n)/gi,
    type: MemoryType.FEEDBACK,
    extract: (m) => `Correction: ${m[0]?.trim()}`,
    importance: 0.85,
  },
  {
    regex: /(?:don'?t|never|stop|avoid)\s+(.+?)(?:\.|$|\n)/gi,
    type: MemoryType.FEEDBACK,
    extract: (m) => `Negative feedback: ${m[0]?.trim()}`,
    importance: 0.8,
  },

  // ── Project Context ──────────────────────────────────────────
  {
    regex: /(?:we|i)'?(?:'ve| have)?\s+(?:decided|chosen|switched)\s+(?:to|on)\s+(.+?)(?:\.|$|\n)/gi,
    type: MemoryType.PROJECT_CONTEXT,
    extract: (m) => `Decision: ${m[0]?.trim()}`,
    importance: 0.75,
  },
  {
    regex: /(?:the|our)\s+(?:architecture|tech stack|stack)\s+(?:is|uses|consists of)\s+(.+?)(?:\.|$|\n)/gi,
    type: MemoryType.PROJECT_CONTEXT,
    extract: (m) => `Architecture: ${m[0]?.trim()}`,
    importance: 0.8,
  },
  {
    regex: /(?:using|built with|powered by)\s+(.+?)(?:for|to|\.|$|\n)/gi,
    type: MemoryType.PROJECT_CONTEXT,
    extract: (m) => `Tech: ${m[0]?.trim()}`,
    importance: 0.5,
  },
  {
    regex: /(?:the|this)\s+(?:project|repo|codebase)\s+(?:is|uses|follows)\s+(.+?)(?:\.|$|\n)/gi,
    type: MemoryType.PROJECT_CONTEXT,
    extract: (m) => `Project: ${m[0]?.trim()}`,
    importance: 0.7,
  },

  // ── Reference ────────────────────────────────────────────────
  {
    regex: /https?:\/\/[^\s)]+(?:[^\s.,;)])/gi,
    type: MemoryType.REFERENCE,
    extract: (m) => `URL reference: ${m[0]?.trim()}`,
    importance: 0.3,
  },
  {
    regex: /(?:key|api|secret|endpoint|token)\s+(?:is|:|\s+=\s+)\s*(?:https?:\/\/|[a-zA-Z0-9\-_.]+\.[a-z]{2,})[^\s,.)]*/gi,
    type: MemoryType.REFERENCE,
    extract: (m) => `Config reference: ${m[0]?.trim()}`,
    importance: 0.4,
  },
];

// ---------------------------------------------------------------------------
// MemoryExtractor
// ---------------------------------------------------------------------------

export class MemoryExtractor {
  private store: IMemoryStore;
  private minConfidence: number;

  constructor(store: IMemoryStore, minConfidence = 0.4) {
    this.store = store;
    this.minConfidence = minConfidence;
  }

  /**
   * Extract memories from a session transcript.
   *
   * Steps:
   * 1. Apply heuristic extraction patterns to find candidate facts
   * 2. Score candidates by pattern confidence
   * 3. Check for duplicates against existing memories
   * 4. Return deduplicated results (caller decides whether to save)
   */
  extract(transcript: string, options: ExtractionOptions): ExtractionResult {
    const candidates: MemoryInput[] = [];
    const sessionId = options.sessionId;
    const cwd = options.cwd;

    // Apply extraction patterns
    for (const pattern of EXTRACTION_PATTERNS) {
      // Reset regex lastIndex for global patterns
      pattern.regex.lastIndex = 0;

      let match: RegExpMatchArray | null;
      while ((match = pattern.regex.exec(transcript)) !== null) {
        const content = pattern.extract(match);
        if (!content || content.length < 10 || content.length > 500) continue;
        if (pattern.importance < (options.minConfidence ?? this.minConfidence)) continue;

        candidates.push({
          type: pattern.type,
          content,
          keywords: extractKeywords(content),
          source: sessionId,
          cwd,
          importance: pattern.importance,
        });
      }
    }

    // Extract recurring significant terms as potential memories
    const termMemories = this.extractRecurringTerms(transcript, sessionId, cwd);
    candidates.push(...termMemories);

    // Dedup
    let duplicatesFound = 0;
    const deduped: MemoryInput[] = [];

    for (const candidate of candidates) {
      if (options.skipDedup) {
        deduped.push(candidate);
        continue;
      }

      const isDup = this.isDuplicate(candidate);
      if (isDup) {
        duplicatesFound++;
        continue;
      }

      deduped.push(candidate);
    }

    return {
      memories: deduped,
      candidatesEvaluated: candidates.length,
      duplicatesFound,
    };
  }

  /**
   * Extract and save memories from a transcript in one step.
   */
  extractAndSave(transcript: string, options: ExtractionOptions): MemoryInput[] {
    const result = this.extract(transcript, options);

    for (const memory of result.memories) {
      this.store.save(memory);
    }

    return result.memories;
  }

  /**
   * Check if a candidate memory is a duplicate of an existing one.
   * Uses keyword overlap and content similarity.
   */
  isDuplicate(candidate: MemoryInput): boolean {
    const existing = this.store.search(
      candidate.keywords?.slice(0, 5).join(' ') ?? candidate.content,
      10,
    );

    for (const { memory } of existing) {
      if (memory.source === candidate.source) continue; // Same session OK

      // High keyword overlap → likely duplicate
      const overlap = keywordOverlap(candidate.keywords ?? [], memory.keywords);
      if (overlap > 0.6) return true;

      // Near-identical content (after normalization)
      const similarity = contentSimilarity(candidate.content, memory.content);
      if (similarity > 0.8) return true;
    }

    return false;
  }

  /**
   * Extract recurring significant terms from the transcript.
   * Terms that appear 3+ times across different contexts are worth remembering.
   */
  private extractRecurringTerms(
    transcript: string,
    sessionId: string,
    cwd?: string,
  ): MemoryInput[] {
    const words = transcript
      .toLowerCase()
      .replace(/[^a-z0-9\s\-_.\/#@]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 4);

    const freq = new Map<string, number>();
    for (const w of words) {
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }

    const memories: MemoryInput[] = [];
    for (const [word, count] of freq) {
      if (count >= 3 && !isCommonTerm(word)) {
        const context = findContextForTerm(transcript, word);
        memories.push({
          type: MemoryType.PROJECT_CONTEXT,
          content: `Recurring term "${word}" (${count}x): ${context}`,
          keywords: [word],
          source: sessionId,
          cwd,
          importance: Math.min(0.6, 0.2 + count * 0.1),
        });
      }
    }

    return memories.slice(0, 5); // Max 5 recurring term memories
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function keywordOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a.map((k) => k.toLowerCase()));
  const setB = new Set(b.map((k) => k.toLowerCase()));
  let overlap = 0;
  for (const k of setA) {
    if (setB.has(k)) overlap++;
  }
  return overlap / Math.max(setA.size, setB.size);
}

function contentSimilarity(a: string, b: string): number {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na.length === 0 || nb.length === 0) return 0;

  // Simple Jaccard similarity of words
  const wordsA = new Set(na.split(' '));
  const wordsB = new Set(nb.split(' '));
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.size / union.size;
}

function isCommonTerm(word: string): boolean {
  const common = new Set([
    'there', 'their', 'which', 'could', 'would', 'should', 'about',
    'after', 'before', 'during', 'where', 'while', 'because', 'though',
    'these', 'those', 'other', 'every', 'first', 'second', 'number',
  ]);
  return common.has(word);
}

function findContextForTerm(transcript: string, term: string): string {
  const lines = transcript.split('\n');
  for (const line of lines) {
    if (line.toLowerCase().includes(term.toLowerCase())) {
      const trimmed = line.trim();
      return trimmed.length > 200 ? trimmed.slice(0, 197) + '...' : trimmed;
    }
  }
  return term;
}

/**
 * Convenience: create an extractor using the store and run extraction.
 *
 * Usage:
 *   const store = createMemoryStore();
 *   const memories = extractMemories(store, transcript, { sessionId: 'abc' });
 */
export function extractMemories(
  store: IMemoryStore,
  transcript: string,
  options: ExtractionOptions,
): ExtractionResult {
  const extractor = new MemoryExtractor(store);
  return extractor.extract(transcript, options);
}
