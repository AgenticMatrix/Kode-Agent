/**
 * MemoryConsolidator — Merge duplicate and similar memories.
 *
 * Periodically scans the memory store for near-duplicate entries
 * and consolidates them into single, higher-quality memories.
 *
 * Architecture reference: ARCHITECTURE.md §4.10
 */

import type { IMemoryStore } from './store.js';
import type { Memory, MemoryType } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsolidationResult {
  /** Number of merge operations performed */
  mergesPerformed: number;
  /** Number of memories before consolidation */
  beforeCount: number;
  /** Number of memories after consolidation */
  afterCount: number;
  /** Details of each merge */
  merges: MergeDetail[];
}

export interface MergeDetail {
  /** The surviving memory ID */
  kept: string;
  /** IDs of memories merged into the survivor */
  merged: string[];
  /** Reason for the merge */
  reason: string;
}

export interface ConsolidationOptions {
  /** Minimum similarity threshold for merging (0-1, default: 0.7) */
  similarityThreshold?: number;
  /** Maximum memories to scan (default: all) */
  maxScan?: number;
  /** Dry run: report what would be merged without changing anything */
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// MemoryConsolidator
// ---------------------------------------------------------------------------

export class MemoryConsolidator {
  private store: IMemoryStore;
  private similarityThreshold: number;

  constructor(store: IMemoryStore, similarityThreshold = 0.7) {
    this.store = store;
    this.similarityThreshold = similarityThreshold;
  }

  /**
   * Consolidate duplicate/similar memories.
   *
   * Algorithm:
   * 1. Group memories by type
   * 2. Within each type group, find pairs with high similarity
   * 3. Merge pairs: keep the higher-importance memory, merge content
   * 4. Update keywords and importance from merged content
   */
  consolidate(options: ConsolidationOptions = {}): ConsolidationResult {
    const threshold = options.similarityThreshold ?? this.similarityThreshold;
    const allMemories = this.store.list(options.maxScan);
    const beforeCount = allMemories.length;

    const merges: MergeDetail[] = [];
    const mergedIds = new Set<string>();

    // Group by type
    const byType = new Map<MemoryType, Memory[]>();
    for (const m of allMemories) {
      const list = byType.get(m.type) ?? [];
      list.push(m);
      byType.set(m.type, list);
    }

    // Within each type, find similar pairs
    for (const [, group] of byType) {
      for (let i = 0; i < group.length; i++) {
        const a = group[i]!;
        if (mergedIds.has(a.id)) continue;

        for (let j = i + 1; j < group.length; j++) {
          const b = group[j]!;
          if (mergedIds.has(b.id)) continue;

          const similarity = this.computeSimilarity(a, b);
          if (similarity >= threshold) {
            // Merge b into a (keep higher-importance as survivor)
            const [survivor, merged] =
              a.importance >= b.importance
                ? [a, b] as [Memory, Memory]
                : [b, a] as [Memory, Memory];

            // Perform the merge
            this.mergeMemories(survivor, merged);

            mergedIds.add(merged.id);
            merges.push({
              kept: survivor.id,
              merged: [merged.id],
              reason: `Similarity ${similarity.toFixed(2)} (${
                a.content.slice(0, 40)
              }... ↔ ${b.content.slice(0, 40)}...)`,
            });
          }
        }
      }
    }

    // Delete merged memories (unless dry run)
    if (!options.dryRun) {
      for (const id of mergedIds) {
        this.store.delete(id);
      }
    }

    const afterCount = beforeCount - mergedIds.size;

    return {
      mergesPerformed: merges.length,
      beforeCount,
      afterCount,
      merges,
    };
  }

  /**
   * Get a summary of all memories grouped by type.
   */
  getSummary(): Map<MemoryType, { count: number; topKeywords: string[] }> {
    const all = this.store.list();
    const byType = new Map<MemoryType, Memory[]>();

    for (const m of all) {
      const list = byType.get(m.type) ?? [];
      list.push(m);
      byType.set(m.type, list);
    }

    const summary = new Map<MemoryType, { count: number; topKeywords: string[] }>();
    for (const [type, memories] of byType) {
      // Collect top keywords across all memories of this type
      const kwFreq = new Map<string, number>();
      for (const m of memories) {
        for (const kw of m.keywords) {
          kwFreq.set(kw, (kwFreq.get(kw) ?? 0) + 1);
        }
      }

      const topKeywords = Array.from(kwFreq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([kw]) => kw);

      summary.set(type, { count: memories.length, topKeywords });
    }

    return summary;
  }

  // ── Internal ────────────────────────────────────────────────────

  private computeSimilarity(a: Memory, b: Memory): number {
    // Keyword overlap (weight: 0.4)
    const kwScore = keywordJaccardSimilarity(a.keywords, b.keywords);

    // Content word overlap (weight: 0.4)
    const contentScore = wordJaccardSimilarity(a.content, b.content);

    // Source diversity bonus: same-type memories from different sessions
    // are more likely to be independent than true duplicates
    const sourcePenalty = a.source === b.source ? 0 : 0.1;

    // Importance: two low-importance items more likely to be merged
    const importanceFactor = 1 - Math.abs(a.importance - b.importance) * 0.5;

    return (kwScore * 0.4 + contentScore * 0.4 - sourcePenalty) * importanceFactor;
  }

  private mergeMemories(survivor: Memory, merged: Memory): void {
    // Combine content (avoid duplication)
    const combinedContent = mergeContent(survivor.content, merged.content);

    // Combine keywords (unique, sorted by frequency)
    const combinedKeywords = [...new Set([...survivor.keywords, ...merged.keywords])];

    // Average importance, biased toward survivor
    const combinedImportance = Math.min(
      1,
      survivor.importance * 0.7 + merged.importance * 0.3 + 0.05,
    );

    // Update the survivor in the store
    this.store.update(survivor.id, {
      content: combinedContent,
      keywords: combinedKeywords,
      importance: combinedImportance,
      accessCount: survivor.accessCount + merged.accessCount,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function keywordJaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a.map((k) => k.toLowerCase()));
  const setB = new Set(b.map((k) => k.toLowerCase()));
  const intersection = new Set([...setA].filter((k) => setB.has(k)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / Math.max(1, union.size);
}

function wordJaccardSimilarity(a: string, b: string): number {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const wordsA = new Set(normalize(a).split(' ').filter((w) => w.length > 2));
  const wordsB = new Set(normalize(b).split(' ').filter((w) => w.length > 2));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.size / union.size;
}

function mergeContent(a: string, b: string): string {
  // If one contains the other, keep the longer one
  if (a.includes(b)) return a;
  if (b.includes(a)) return b;

  // Otherwise, concatenate with separator
  const combined = `${a}\n${b}`;
  return combined.length > 1000 ? combined.slice(0, 997) + '...' : combined;
}

/**
 * Convenience: consolidate a store in one call.
 */
export function consolidateStore(
  store: IMemoryStore,
  options?: ConsolidationOptions,
): ConsolidationResult {
  const consolidator = new MemoryConsolidator(store);
  return consolidator.consolidate(options);
}
