/**
 * LRU cache utility — Phase 2.3
 *
 * Provides LRU (Least Recently Used) eviction for Map-based caches.
 * JavaScript Map guarantees insertion-order iteration, so the oldest
 * entries appear first in keys() / entries().
 *
 * Supports both raw keepRatio (backward compatible with sliceAnsi) and
 * EvictLevel ('light' | 'medium' | 'half' | 'heavy') for semantic eviction.
 */

import type { EvictLevel } from './cache-eviction.js';

/** Mapping from EvictLevel to the fraction of entries to keep after eviction */
const EVICT_LEVEL_KEEP_RATIO: Record<EvictLevel, number> = {
  light: 0.90,  // evict 10% — gentle cleanup for bursty allocations
  medium: 0.75, // evict 25% — periodic housekeeping
  half: 0.50,   // evict 50% — aggressive after a large render pass
  heavy: 0.25,  // evict 75% — near-reset when memory is tight
};

/**
 * Evict the oldest entries from a Map-based LRU cache.
 *
 * Accepts either a numeric `keepRatio` (0..1, fraction to retain) or an
 * `EvictLevel` string.  When given a level, the corresponding keep ratio
 * from the table above is used.
 *
 * Uses JavaScript Map insertion-order iteration: `cache.keys()` yields
 * entries in insertion order, so evicting from the front removes the
 * least-recently-used entries.
 *
 * @param cache        The Map to evict from.  Content is mutated in-place.
 * @param levelOrRatio Either an EvictLevel string or a numeric keep ratio (0..1).
 */
export function lruEvict<K, V>(cache: Map<K, V>, levelOrRatio: EvictLevel | number): void {
  const keepRatio = typeof levelOrRatio === 'string'
    ? EVICT_LEVEL_KEEP_RATIO[levelOrRatio]
    : levelOrRatio;

  // Fast-paths
  if (keepRatio >= 1) return;        // keep everything
  if (keepRatio <= 0) {              // evict everything
    cache.clear();
    return;
  }

  const targetSize = Math.floor(cache.size * keepRatio);
  const evictCount = cache.size - targetSize;
  if (evictCount <= 0) return;

  // Walk insertion-ordered keys and delete the oldest ones
  const keys = cache.keys();
  for (let i = 0; i < evictCount; i++) {
    const next = keys.next();
    if (next.done) break;
    cache.delete(next.value);
  }
}
