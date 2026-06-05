/**
 * cache-eviction compat stub — Phase 0
 *
 * Manages Ink's internal caches (char, hyperlink, style pools).
 * Phase 0 stub is a no-op.
 */

export type EvictLevel = 'light' | 'medium' | 'heavy' | 'half';

export interface InkCacheSizes {
  charPool: number;
  hyperlinkPool: number;
  stylePool: number;
}

/**
 * Evict Ink's internal caches at the given level.
 * Phase 0 stub — does nothing.
 */
export function evictInkCaches(_level?: EvictLevel): void {
  // Phase 0: no-op. Full implementation clears CharCache,
  // StylePool, and Yoga node caches to free memory.
}

/** Get current cache sizes. Phase 0 stub — zeros. */
export function getInkCacheSizes(): InkCacheSizes {
  return {
    charPool: 0,
    hyperlinkPool: 0,
    stylePool: 0,
  };
}
