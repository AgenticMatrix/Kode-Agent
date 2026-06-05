/**
 * LRU cache utility — Phase 0
 *
 * Simple LRU eviction helper, replaces the vendored ink/lru.js.
 * Used by sliceAnsi.ts for its cache eviction.
 */

/**
 * Evict entries from a Map to maintain a target size.
 * Keeps `keepRatio` (0..1) fraction of entries, evicting the oldest first.
 *
 * @param cache  The Map to evict from
 * @param keepRatio  Fraction of entries to keep (0 = evict all, 1 = keep all)
 */
export function lruEvict<K, V>(cache: Map<K, V>, keepRatio: number): void {
  if (keepRatio >= 1) return;
  if (keepRatio <= 0) {
    cache.clear();
    return;
  }

  const targetSize = Math.floor(cache.size * keepRatio);
  const evictCount = cache.size - targetSize;

  const keys = cache.keys();
  for (let i = 0; i < evictCount; i++) {
    const { value, done } = keys.next();
    if (done) break;
    cache.delete(value);
  }
}
