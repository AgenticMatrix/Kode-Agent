/**
 * ScrollBox compat stub — Phase 0
 *
 * Simple Box wrapper with forwardRef. Scroll methods are no-ops.
 * Full virtual-scrolling implementation deferred to later phases.
 */
import React, { forwardRef } from 'react';
import { Box } from 'ink';

// ---------------------------------------------------------------------------
// Types (compatible with the old ScrollBoxHandle / ScrollBoxProps)
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
  setClampBounds(min: number, max: number): void;
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
  /** CA extension: click handler (Phase 0 — no-op) */
  onClick?: (...args: any[]) => void;
  /** CA extension: sticky scroll mode */
  stickyScroll?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ScrollBox = forwardRef<ScrollBoxHandle, ScrollBoxProps>(
  function ScrollBox({ children, onClick, stickyScroll, ..._boxProps }, ref) {
    // Expose a stub handle — every method is a no-op for Phase 0
    React.useImperativeHandle(ref, () => ({
      scrollTo: () => {},
      scrollBy: () => {},
      scrollToElement: () => {},
      scrollToBottom: () => {},
      getScrollTop: () => 0,
      getPendingDelta: () => 0,
      getScrollHeight: () => 0,
      getFreshScrollHeight: () => 0,
      getViewportHeight: () => 0,
      getViewportTop: () => 0,
      getLastManualScrollAt: () => 0,
      isSticky: () => true,
      subscribe: () => () => {},
      setClampBounds: () => {},
    }), []);

    return (
      <Box flexDirection="column" overflow="hidden" {..._boxProps as any}>
        {children}
      </Box>
    );
  },
);

export default ScrollBox;
