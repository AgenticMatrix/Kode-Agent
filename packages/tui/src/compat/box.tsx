/**
 * Box compat wrapper — Phase 2
 *
 * Wraps ink v7 Box to accept CA-specific props (onClick, mouse events)
 * that were added to the old vendored ink Box.
 * Phase 2: mouse events are dispatched via the MouseProvider context.
 */
import { Box as InkBox } from 'ink';
import type { BoxProps as InkBoxProps } from 'ink';
import type { ReactNode } from 'react';
import React, { forwardRef, useEffect, useRef } from 'react';
import {
  useMouseTracker,
  createMouseHandler,
  type MouseCallbacks,
} from './mouse-tracker.js';

export interface BoxProps extends InkBoxProps {
  /** CA extension: children (explicit for React 19 type compat) */
  children?: ReactNode;
  /** CA extension: click handler — fires on mouse release near the press position */
  onClick?: (...args: any[]) => void;
  /** CA extension: mouse button press */
  onMouseDown?: (...args: any[]) => void;
  /** CA extension: mouse button release */
  onMouseUp?: (...args: any[]) => void;
  /** CA extension: mouse drag (motion while button held) */
  onMouseDrag?: (...args: any[]) => void;
  /** CA extension: mouse enters component area */
  onMouseEnter?: (...args: any[]) => void;
  /** CA extension: mouse leaves component area */
  onMouseLeave?: (...args: any[]) => void;
  /** CA extension: opaque background fill */
  opaque?: boolean;
}

/**
 * Box component — wraps ink v7 Box with SGR mouse event support.
 * Uses MouseProvider context to register handlers; coordinates are
 * terminal-absolute (Phase 2).
 */
const Box = forwardRef<unknown, BoxProps>(
  ({ onClick, onMouseDown, onMouseUp, onMouseDrag, onMouseEnter, onMouseLeave, opaque, ...props }, _ref) => {
    // opaque background — render a background-colored Box behind content
    // Phase 2: rendered as a separate layer via a wrapper
    void opaque;

    // Mouse event registration via the shared MouseProvider context
    const tracker = useMouseTracker();
    const callbacksRef = useRef<MouseCallbacks>({});

    // Keep the ref in sync so the registered handler always sees the
    // latest callbacks without re-registering.
    callbacksRef.current = {
      onClick: onClick as MouseCallbacks['onClick'] | undefined,
      onMouseDown: onMouseDown as MouseCallbacks['onMouseDown'] | undefined,
      onMouseUp: onMouseUp as MouseCallbacks['onMouseUp'] | undefined,
      onMouseDrag: onMouseDrag as MouseCallbacks['onMouseDrag'] | undefined,
      onMouseEnter: onMouseEnter as MouseCallbacks['onMouseEnter'] | undefined,
      onMouseLeave: onMouseLeave as MouseCallbacks['onMouseLeave'] | undefined,
    };

    useEffect(() => {
      // Register a proxy handler that delegates to the current ref
      const cleanup = createMouseHandler(tracker, {
        onClick(e) { callbacksRef.current.onClick?.(e); },
        onMouseDown(e) { callbacksRef.current.onMouseDown?.(e); },
        onMouseUp(e) { callbacksRef.current.onMouseUp?.(e); },
        onMouseDrag(e) { callbacksRef.current.onMouseDrag?.(e); },
        onMouseEnter(e) { callbacksRef.current.onMouseEnter?.(e); },
        onMouseLeave(e) { callbacksRef.current.onMouseLeave?.(e); },
      });
      return cleanup;
    }, [tracker]);

    return <InkBox {...props} ref={_ref as any} />;
  },
);
Box.displayName = 'Box';

export default Box;
