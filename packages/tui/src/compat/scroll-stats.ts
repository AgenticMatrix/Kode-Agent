/**
 * scrollFastPathStats — Phase 3.1 Live Statistics
 *
 * Mutable runtime counters for the ScrollBox hardware-scroll fast path.
 * Updated in O(1) from ScrollBox rendering so overhead is negligible.
 *
 * ## Counters
 * - fastPathFrames  — frames that used DECSTBM hardware scroll
 * - slowPathFrames  — frames that fell back to full software re-render
 * - totalShiftedRows — cumulative rows shifted via hardware scroll
 * - totalRenderedRows — cumulative rows rendered via software (virtual scroll)
 * - declined         — sub-stats for hardware-attempt-then-fallback frames
 *
 * ## Usage
 * ```ts
 * import { scrollFastPathStats, resetScrollFastPathStats } from '@coder/tui';
 * console.log(scrollFastPathStats.slowPathFrames);
 * resetScrollFastPathStats();
 * ```
 */

export interface ScrollFastPathStats {
  /** Number of frames that used the DECSTBM hardware scroll fast path */
  fastPathFrames: number;
  /** Number of frames that fell back to full diff (software re-render) */
  slowPathFrames: number;
  /** Total rows shifted via hardware scroll */
  totalShiftedRows: number;
  /** Total rows rendered via software (virtual scroll re-render) */
  totalRenderedRows: number;
  /** Sub-stats for declined fast-path attempts */
  declined?: ScrollFastPathStats;
}

// ---------------------------------------------------------------------------
// Mutable live statistics (Phase 3.1 — replaces Phase 0 zero-value stub)
// ---------------------------------------------------------------------------

/** Sub-stats: DECSTBM attempted but fell back to software path. */
export const declinedScrollFastPathStats: ScrollFastPathStats = {
  fastPathFrames: 0,
  slowPathFrames: 0,
  totalShiftedRows: 0,
  totalRenderedRows: 0,
};

/** Primary live statistics.  Mutated by ScrollBox during rendering. */
export const scrollFastPathStats: ScrollFastPathStats = {
  fastPathFrames: 0,
  slowPathFrames: 0,
  totalShiftedRows: 0,
  totalRenderedRows: 0,
  declined: declinedScrollFastPathStats,
};

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Reset all scroll statistics to zero.
 *
 * Useful between test runs, after a session restart, or when the user
 * wants fresh metrics for a specific operation.
 */
export function resetScrollFastPathStats(): void {
  scrollFastPathStats.fastPathFrames = 0;
  scrollFastPathStats.slowPathFrames = 0;
  scrollFastPathStats.totalShiftedRows = 0;
  scrollFastPathStats.totalRenderedRows = 0;

  if (scrollFastPathStats.declined) {
    scrollFastPathStats.declined.fastPathFrames = 0;
    scrollFastPathStats.declined.slowPathFrames = 0;
    scrollFastPathStats.declined.totalShiftedRows = 0;
    scrollFastPathStats.declined.totalRenderedRows = 0;
  }
}
