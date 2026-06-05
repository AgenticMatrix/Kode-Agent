/**
 * scrollFastPathStats compat stub — Phase 0
 *
 * Statistics for the ScrollBox hardware-scroll fast path.
 * Phase 0 stub returns zero values.
 */

export interface ScrollFastPathStats {
  /** Number of frames that used the DECSTBM hardware scroll fast path */
  fastPathFrames: number;
  /** Number of frames that fell back to full diff */
  slowPathFrames: number;
  /** Total rows shifted via hardware scroll */
  totalShiftedRows: number;
  /** Total rows rendered via full diff */
  totalRenderedRows: number;
  /** Sub-stats for declined fast-path attempts */
  declined?: ScrollFastPathStats;
}

/** Phase 0 stub — separate declined sub-stats (no self-reference). */
export const declinedScrollFastPathStats: ScrollFastPathStats = {
  fastPathFrames: 0,
  slowPathFrames: 0,
  totalShiftedRows: 0,
  totalRenderedRows: 0,
};

/** Phase 0 stub — returns zero-value stats. */
export const scrollFastPathStats: ScrollFastPathStats = {
  fastPathFrames: 0,
  slowPathFrames: 0,
  totalShiftedRows: 0,
  totalRenderedRows: 0,
  declined: declinedScrollFastPathStats,
};
