/**
 * cache-eviction — Phase 2.3
 *
 * Manages string-intern pools (char, hyperlink, style) used by the TUI
 * rendering pipeline to reduce repeated string allocations.  Each pool is
 * backed by a Map-based LRU cache that auto-evicts on insert.
 *
 * Public API:
 *   - internChar / internStyle / internHyperlink — intern a string, evicting
 *     the pool if it exceeds the max size.
 *   - evictInkCaches(level) — force-evict all pools at a given level.
 *   - getInkCacheSizes() — return current pool sizes.
 *
 * All type signatures match the Phase 0 stubs so downstream consumers
 * (entry-exports.ts) need zero changes.
 */

import { lruEvict } from './lru.js';

// ---------------------------------------------------------------------------
// Types (unchanged from Phase 0)
// ---------------------------------------------------------------------------

export type EvictLevel = 'light' | 'medium' | 'heavy' | 'half';

export interface InkCacheSizes {
  /** Number of unique characters interned */
  charPool: number;
  /** Number of OSC 8 hyperlink escape strings interned */
  hyperlinkPool: number;
  /** Number of ANSI style / SGR strings interned */
  stylePool: number;
}

// ---------------------------------------------------------------------------
// Internal pools
// ---------------------------------------------------------------------------

/**
 * Maximum entries per pool before auto-eviction triggers.
 * 2048 is generous enough to absorb a large render frame without
 * thrashing, while still capping memory for long-running sessions.
 */
const POOL_MAX = 2048;

const charPool = new Map<string, string>();
const hyperlinkPool = new Map<string, string>();
const stylePool = new Map<string, string>();

/**
 * Touch an entry in a Map — move it to the end (most-recently-used).
 * Used to refresh LRU ordering on cache hits.
 */
function touch<K, V>(pool: Map<K, V>, key: K): void {
  const value = pool.get(key)!;
  pool.delete(key);
  pool.set(key, value);
}

/**
 * Insert a value into a pool, auto-evicting if the pool has reached
 * POOL_MAX.  Returns the interned value (always the same reference for
 * a given key).
 */
function poolSet<K>(pool: Map<K, K>, key: K): K {
  const cached = pool.get(key);
  if (cached !== undefined) {
    touch(pool, key);
    return cached;
  }

  if (pool.size >= POOL_MAX) {
    lruEvict(pool, 'light');
  }

  pool.set(key, key);
  return key;
}

// ---------------------------------------------------------------------------
// Intern helpers (public — usable by other compat modules)
// ---------------------------------------------------------------------------

/**
 * Intern a single-character string.  Repeated calls with the same
 * character return the identical string reference, reducing GC pressure
 * during heavy terminal output.
 */
export function internChar(ch: string): string {
  return poolSet(charPool, ch);
}

/**
 * Intern an ANSI SGR / style escape string (e.g. `\x1b[31m`).
 * Styles are heavily repeated across terminal frames.
 */
export function internStyle(style: string): string {
  return poolSet(stylePool, style);
}

/**
 * Intern an OSC 8 hyperlink escape string.  Hyperlinks are long and
 * expensive to construct; interning them avoids redundant allocation.
 */
export function internHyperlink(link: string): string {
  return poolSet(hyperlinkPool, link);
}

// ---------------------------------------------------------------------------
// Public API (evictInkCaches + getInkCacheSizes)
// ---------------------------------------------------------------------------

/**
 * Force-evict all internal pools at the given eviction level.
 *
 * @param level  How aggressively to evict.  Defaults to 'medium'.
 */
export function evictInkCaches(level: EvictLevel = 'medium'): void {
  lruEvict(charPool, level);
  lruEvict(hyperlinkPool, level);
  lruEvict(stylePool, level);
}

/**
 * Return the current sizes of all internal pools.
 */
export function getInkCacheSizes(): InkCacheSizes {
  return {
    charPool: charPool.size,
    hyperlinkPool: hyperlinkPool.size,
    stylePool: stylePool.size,
  };
}
