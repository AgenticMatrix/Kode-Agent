/**
 * ScrollBox — Phase 1.1 Virtual Scrolling Engine
 *
 * A terminal-native virtual-scrolling container built on Ink v7.
 *
 * ## Features
 * - Virtual rendering: only children within the viewport are rendered
 * - DECSTBM hardware scroll fast-path for supported terminals
 * - Subscriber pattern: Set<() => void> for external state observation
 * - Sticky scroll: auto-follows new content when scrolled to bottom
 * - Mouse wheel integration via MouseProvider
 * - Keyboard navigation: arrow keys, PageUp/Down, Home/End
 * - Clamp bounds for scroll range constraints
 *
 * ## Constraints
 * - Zero new npm dependencies
 * - ScrollBoxHandle / ScrollBoxProps interfaces unchanged
 * - forwardRef + useImperativeHandle pattern preserved
 * - MouseProvider onClick integration preserved
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Box, measureElement, useInput } from 'ink';
import {
  useMouseTracker,
  createMouseHandler,
  type MouseCallbacks,
  type SgrMouseEvent,
} from './mouse-tracker.js';
import { scrollFastPathStats } from './scroll-stats.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScrollBoxHandle {
  /** Jump to absolute scroll position */
  scrollTo(y: number): void;
  /** Relative scroll */
  scrollBy(dy: number): void;
  /** Scroll to a descendant element */
  scrollToElement(el: unknown, offset?: number): void;
  /** Scroll to the bottom */
  scrollToBottom(): void;
  /** Current scroll offset */
  getScrollTop(): number;
  /** Pending delta */
  getPendingDelta(): number;
  /** Full content height */
  getScrollHeight(): number;
  getFreshScrollHeight(): number;
  getViewportHeight(): number;
  getViewportTop(): number;
  getLastManualScrollAt(): number;
  isSticky(): boolean;
  subscribe(listener: () => void): () => void;
  setClampBounds(min: number | undefined, max: number | undefined): void;
}

export interface ScrollBoxProps {
  children?: React.ReactNode;
  /** Flexbox style props passed through to the underlying Box */
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  flexGrow?: number;
  flexShrink?: number;
  width?: number | string;
  height?: number | string;
  minHeight?: number | string;
  /** CA extension: click handler */
  onClick?: (...args: any[]) => void;
  /** CA extension: sticky scroll mode */
  stickyScroll?: boolean;
}

// ---------------------------------------------------------------------------
// DECSTBM — Terminal Native Scroll Region (hardware fast-path)
//
// NOTE: `resetDECSTBMRegion` is active (cleanup phase).
// `_setDECSTBMRegion` / `_decstbmScrollUp` / `_decstbmScrollDown` are
// reserved for Phase 2+ when Ink layout introspection provides absolute
// terminal-row positions.  They are prefixed and void-suppressed to avoid
// dead-code warnings.
// ---------------------------------------------------------------------------

/**
 * Set the terminal scroll region to [top, bottom] (1-indexed, inclusive).
 * @internal Reserved for Phase 2+ DECSTBM integration.
 */
function _setDECSTBMRegion(top: number, bottom: number): void {
  if (top < 1 || bottom < top) return;
  process.stdout.write(`\x1b[${top};${bottom}r`);
}
void _setDECSTBMRegion;

/** Reset the scroll region to full screen. */
function resetDECSTBMRegion(): void {
  process.stdout.write('\x1b[r');
}

/** @internal Reserved for Phase 2+ DECSTBM integration. */
function _decstbmScrollUp(n: number): void {
  if (n <= 0) return;
  process.stdout.write(`\x1b[${n}S`);
}
void _decstbmScrollUp;

/** @internal Reserved for Phase 2+ DECSTBM integration. */
function _decstbmScrollDown(n: number): void {
  if (n <= 0) return;
  process.stdout.write(`\x1b[${n}T`);
}
void _decstbmScrollDown;

// ---------------------------------------------------------------------------
// Virtual scroll state (mutable ref — avoids re-render spam)
// ---------------------------------------------------------------------------

interface ScrollState {
  scrollTop: number;
  viewportHeight: number;
  contentHeight: number;
  pendingDelta: number;
  lastManualScrollAt: number;
  clampMin: number;
  clampMax: number;
  sticky: boolean;
  /** Whether the viewport is at the bottom (within 1 row tolerance) */
  atBottom: boolean;
}

function createInitialState(sticky: boolean): ScrollState {
  return {
    scrollTop: 0,
    viewportHeight: 0,
    contentHeight: 0,
    pendingDelta: 0,
    lastManualScrollAt: 0,
    clampMin: 0,
    clampMax: Number.MAX_SAFE_INTEGER,
    sticky,
    atBottom: true,
  };
}

// ---------------------------------------------------------------------------
// Clamp helpers
// ---------------------------------------------------------------------------

function clampScrollTop(
  desired: number,
  clampMin: number,
  clampMax: number,
  maxScroll: number,
): number {
  // Defend against undefined / NaN clamp bounds injected by external
  // setClampBounds(undefined, undefined) — see GH-issue.
  const safeMin = typeof clampMin === 'number' && !Number.isNaN(clampMin) ? clampMin : 0;
  const safeMax = typeof clampMax === 'number' && !Number.isNaN(clampMax) ? clampMax : Number.MAX_SAFE_INTEGER;
  const lower = Math.max(safeMin, 0);
  const upper = Math.min(safeMax, maxScroll);
  if (desired < lower) return lower;
  if (desired > upper) return upper;
  return desired;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ScrollBox = forwardRef<ScrollBoxHandle, ScrollBoxProps>(
  function ScrollBox({ children, onClick, stickyScroll = true, ...boxProps }, ref) {
    // ---- mutable state (refs avoid stale-closure in imperative handle) ----
    const stateRef = useRef<ScrollState>(createInitialState(stickyScroll));
    const listenersRef = useRef<Set<() => void>>(new Set());
    const callbacksRef = useRef<MouseCallbacks>({});
    const boxRef = useRef<any>(null);
    const lastContentCountRef = useRef(0);

    // Keep mouse callbacks ref in sync (direct assignment in render body —
    // avoids a useEffect and ensures the latest callback is always seen)
    callbacksRef.current = {
      onClick: onClick as MouseCallbacks['onClick'] | undefined,
    };

    // Sync stickyScroll prop
    useEffect(() => {
      stateRef.current.sticky = stickyScroll;
    }, [stickyScroll]);

    // ---- version counter to trigger re-renders (for virtual clipping) ----
    const [version, setVersion] = useState(0);

    /**
     * Notify all subscribers and trigger a React re-render.
     * Called whenever scroll state changes.
     */
    const notify = useCallback(() => {
      setVersion((v) => v + 1);
      for (const fn of listenersRef.current) {
        fn();
      }
    }, []);

    /**
     * Mark a scroll operation as "manual" (user-initiated).
     * Manual scrolls disable sticky bottom-following.
     */
    function markManual(): void {
      stateRef.current.lastManualScrollAt = Date.now();
      stateRef.current.atBottom = false;
    }

    // ---- core scroll logic ----

    function applyScroll(dy: number, manual: boolean): void {
      const s = stateRef.current;
      const maxScroll = Math.max(0, s.contentHeight - s.viewportHeight);
      const newTop = clampScrollTop(
        s.scrollTop + dy,
        s.clampMin,
        s.clampMax,
        maxScroll,
      );
      if (newTop === s.scrollTop) return; // no change

      s.pendingDelta += dy;

      // DECSTBM fast-path integration point (Phase 2+):
      // When hardware scrolling is enabled, attempt DECSTBM before
      // falling back to software re-render:
      //
      //   if (hardwareScroll(dy)) {
      //     scrollFastPathStats.fastPathFrames++;
      //     scrollFastPathStats.totalShiftedRows += Math.abs(dy);
      //   } else {
      //     scrollFastPathStats.declined!.fastPathFrames++;
      //   }
      //
      // For now, all scrolls go through the software path and are
      // counted by the post-render useEffect below.

      s.scrollTop = newTop;
      s.atBottom = newTop >= maxScroll - 1;
      if (manual) markManual();
      notify();
    }

    function scrollTo(y: number): void {
      const s = stateRef.current;
      const maxScroll = Math.max(0, s.contentHeight - s.viewportHeight);
      const clamped = clampScrollTop(y, s.clampMin, s.clampMax, maxScroll);
      if (clamped === s.scrollTop) return;
      s.scrollTop = clamped;
      s.atBottom = clamped >= maxScroll - 1;
      markManual();
      notify();
    }

    function scrollBy(dy: number): void {
      applyScroll(dy, true);
    }

    function scrollToElement(el: unknown, offset = 0): void {
      // Phase 2.3: first try Yoga node position for accurate layout-aware
      // scrolling, then fall back to child-index scanning.
      const domEl = el as Record<string, any> | null | undefined;
      const yogaNode =
        domEl?.yogaNode ??
        domEl?.unstable__getYogaNode?.() ??
        null;

      if (yogaNode && typeof yogaNode.getComputedLayout === 'function') {
        const layout = yogaNode.getComputedLayout();
        const targetY = Number(layout.top ?? 0) + Number(offset);
        scrollTo(targetY);
        return;
      }

      // Fallback: scan children by identity
      const childrenArray = React.Children.toArray(children);
      const idx = childrenArray.indexOf(el as any);
      if (idx >= 0) {
        scrollTo(idx + offset);
      }
    }

    function scrollToBottom(): void {
      const s = stateRef.current;
      const maxScroll = Math.max(0, s.contentHeight - s.viewportHeight);
      // Guard: skip if already at bottom to avoid unnecessary re-render
      if (s.scrollTop === maxScroll && s.atBottom) return;
      s.scrollTop = maxScroll;
      s.atBottom = true;
      // Re-enter sticky mode — explicit scroll-to-bottom means the
      // user wants to resume auto-following content.
      s.sticky = true;
      s.pendingDelta = 0;
      notify();
    }

    // ---- sticky scroll ----

    function isSticky(): boolean {
      const s = stateRef.current;
      return s.sticky && s.atBottom;
    }

    // ---- keyboard scrolling ----

    useInput((input: string, key: any) => {
      const s = stateRef.current;

      if (key.upArrow) {
        applyScroll(-1, true);
      } else if (key.downArrow) {
        applyScroll(1, true);
      } else if (key.pageUp) {
        applyScroll(-Math.max(1, Math.floor(s.viewportHeight * 0.8)), true);
      } else if (key.pageDown) {
        applyScroll(Math.max(1, Math.floor(s.viewportHeight * 0.8)), true);
      } else if (key.home) {
        scrollTo(0);
      } else if (key.end) {
        scrollToBottom();
      }
      // suppress unused warning
      void input;
    });

    // ---- mouse: wheel scrolling + click integration ----

    const tracker = useMouseTracker();

    // Wheel scrolling via direct SGR handler
    useEffect(() => {
      const unregister = tracker.registerHandler((ev: SgrMouseEvent) => {
        if (ev.action === 'wheel-up') {
          applyScroll(-3, true);
        } else if (ev.action === 'wheel-down') {
          applyScroll(3, true);
        }
      });
      return unregister;
    }, [tracker]);

    // Click integration — uses createMouseHandler for proper
    // press/release matching.  The proxy dereferences callbacksRef
    // at call time so it always sees the latest onClick prop.
    useEffect(() => {
      const cleanup = createMouseHandler(tracker, {
        onClick(e) {
          callbacksRef.current.onClick?.(e);
        },
      });
      return cleanup;
    }, [tracker]);

    // ---- viewport measurement (Yoga + terminal fallback) ----

    /**
     * Update viewport height, preferring Yoga measurement from the rendered
     * Box, falling back to terminal dimensions.
     *
     * `measureElement` is called in a useEffect (post-render) because Yoga
     * hasn't computed layout during the render phase.
     */
    useEffect(() => {
      const s = stateRef.current;
      let newHeight = s.viewportHeight;

      // 1) Yoga measurement — most accurate
      if (boxRef.current) {
        try {
          const dims = measureElement(boxRef.current);
          // The Box height includes hidden children via spacers if virtual
          // scrolling is active, which equals contentHeight, not viewportHeight.
          // We use the height prop or terminal rows for viewport, NOT Yoga.
          // Yoga is used for contentHeight below.
        } catch {
          // Yoga node not yet available — fall through to terminal estimate
        }
      }

      // 2) Terminal-based estimate
      if (process.stdout.isTTY && process.stdout.rows) {
        const rows = process.stdout.rows;
        const estimated = boxProps.height
          ? typeof boxProps.height === 'number'
            ? boxProps.height
            : parseInt(String(boxProps.height), 10) || rows
          : Math.max(1, Math.floor(rows * 0.6));
        newHeight = estimated;
      } else {
        newHeight = 24; // fallback for non-TTY
      }

      if (newHeight !== s.viewportHeight && newHeight > 0) {
        s.viewportHeight = newHeight;
      }
    }, [version]);

    // ---- content height tracking ----

    /**
     * Update content height using Yoga measurement on the rendered Box.
     *
     * With virtual scrolling active (spacers for hidden rows), the Box's
     * Yoga-computed height equals the total content height: visible children
     * + top spacer + bottom spacer.  `measureElement` reads this after each
     * render to keep the cache accurate.
     *
     * Falls back to child count when Yoga isn't available.
     */
    const childrenArray = useMemo(
      () => React.Children.toArray(children),
      [children],
    );

    // Update contentHeight using Yoga measurement post-render
    useEffect(() => {
      const s = stateRef.current;
      let newHeight = childrenArray.length; // fallback

      if (boxRef.current) {
        try {
          const dims = measureElement(boxRef.current);
          if (dims.height > 0) {
            newHeight = dims.height;
          }
        } catch {
          // Yoga not available — keep child-count fallback
        }
      }

      if (newHeight !== s.contentHeight) {
        const prevHeight = s.contentHeight;
        s.contentHeight = newHeight;

        // If sticky, auto-scroll to bottom when new content arrives.
        // Use childrenArray.length (stable item count) rather than Yoga
        // height (which fluctuates on viewport resize — e.g. IME composition)
        // to decide whether content actually grew.
        const contentGrew = childrenArray.length > lastContentCountRef.current;
        lastContentCountRef.current = childrenArray.length;

        if (isSticky() && contentGrew && prevHeight > 0) {
          const maxScroll = Math.max(0, newHeight - s.viewportHeight);
          s.scrollTop = maxScroll;
          s.atBottom = true;
        }
        notify();
      }
    }, [childrenArray.length, version]);

    // ---- DECSTBM lifecycle ----

    // Attempt to set DECSTBM region when viewport dimensions are known
    useEffect(() => {
      const s = stateRef.current;
      if (s.viewportHeight <= 0) return;

      // Set scroll region to cover the viewport area
      // Top is estimated as 0 (viewport fills from top of ScrollBox)
      // Bottom is viewportHeight
      // In practice, we'd need the absolute terminal row of this Box,
      // which requires Ink layout introspection — deferred.
      // For Phase 1.1, we skip DECSTBM region setup and rely on
      // software virtual scrolling.

      return () => {
        resetDECSTBMRegion();
      };
    }, [version]);

    // ---- imperative handle ----

    useImperativeHandle(ref, () => ({
      scrollTo,
      scrollBy,
      scrollToElement,
      scrollToBottom() {
        scrollToBottom();
      },
      getScrollTop: () => stateRef.current.scrollTop,
      getPendingDelta: () => stateRef.current.pendingDelta,
      getScrollHeight: () => stateRef.current.contentHeight,
      /**
       * Fresh content height measured directly from the Yoga layout.
       * Falls back to the cached contentHeight when Yoga isn't available.
       */
      getFreshScrollHeight: (): number => {
        if (boxRef.current) {
          try {
            const dims = measureElement(boxRef.current);
            if (dims.height > 0) return dims.height;
          } catch {
            // Yoga not available
          }
        }
        return stateRef.current.contentHeight;
      },
      getViewportHeight: () => stateRef.current.viewportHeight,
      getViewportTop: () => stateRef.current.scrollTop,
      getLastManualScrollAt: () => stateRef.current.lastManualScrollAt,
      isSticky: () => isSticky(),
      subscribe(listener: () => void): () => void {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
      setClampBounds(min: number | undefined, max: number | undefined): void {
        const s = stateRef.current;
        // Allow undefined to reset to defaults (used by useVirtualHistory
        // to clear virtual-scroll clamping when sticky is active).
        s.clampMin = typeof min === 'number' && !Number.isNaN(min) ? min : 0;
        s.clampMax = typeof max === 'number' && !Number.isNaN(max) ? max : Number.MAX_SAFE_INTEGER;
        // Re-clamp current scrollTop
        const maxScroll = Math.max(0, s.contentHeight - s.viewportHeight);
        const clamped = clampScrollTop(s.scrollTop, s.clampMin, s.clampMax, maxScroll);
        if (clamped !== s.scrollTop) {
          s.scrollTop = clamped;
          notify();
        }
      },
    }), []);

    // ---- scroll performance statistics (Phase 3.1) ----

    /**
     * Bridge render-phase values into a post-commit effect so stat updates
     * stay O(1) and don't trigger re-renders.
     */
    const statsRef = useRef({ renderedRows: 0 });

    // ---- virtual rendering ----

    const s = stateRef.current;
    const totalChildren = childrenArray.length;
    const maxScroll = Math.max(0, totalChildren - s.viewportHeight);

    // Clamp current scroll position
    const safeScrollTop = clampScrollTop(
      s.scrollTop,
      s.clampMin,
      s.clampMax,
      maxScroll,
    );

    // Visible range
    const visibleStart = Math.max(0, Math.min(safeScrollTop, totalChildren));
    const visibleEnd = Math.min(
      totalChildren,
      visibleStart + Math.max(1, s.viewportHeight),
    );

    const visibleKids = childrenArray.slice(visibleStart, visibleEnd);
    const topHiddenCount = visibleStart;
    const bottomHiddenCount = totalChildren - visibleEnd;

    // ---- commit scroll stats (Phase 3.1) ----

    // Capture rendered row count during render for the post-commit effect
    statsRef.current.renderedRows = visibleKids.length;

    // Increment software-path counters after React commits the frame.
    // Using useEffect (no deps = every render) ensures we count each
    // terminal paint exactly once.
    useEffect(() => {
      scrollFastPathStats.slowPathFrames++;
      scrollFastPathStats.totalRenderedRows += statsRef.current.renderedRows;
    });

    // ---- render ----

    return (
      <Box
        ref={boxRef}
        flexDirection="column"
        overflow="hidden"
        {...boxProps as any}
      >
        {/* Top spacer: pushes content down by hidden rows */}
        {topHiddenCount > 0 && (
          <Box height={topHiddenCount} flexShrink={0} />
        )}

        {/* Visible children only */}
        {visibleKids}

        {/* Bottom spacer: reserves space for hidden rows below */}
        {bottomHiddenCount > 0 && (
          <Box height={bottomHiddenCount} flexShrink={0} />
        )}
      </Box>
    );
  },
);

ScrollBox.displayName = 'ScrollBox';

export default ScrollBox;
