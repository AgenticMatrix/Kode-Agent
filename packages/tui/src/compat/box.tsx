/**
 * Box compat wrapper — Phase 0
 *
 * Wraps ink v7 Box to accept CA-specific props (onClick, mouse events)
 * that were added to the old vendored ink Box.
 * Phase 0: extra props are silently ignored.
 */
import { Box as InkBox } from 'ink';
import type { BoxProps as InkBoxProps } from 'ink';
import type { ReactNode } from 'react';
import { forwardRef } from 'react';

export interface BoxProps extends InkBoxProps {
  /** CA extension: children (explicit for React 19 type compat) */
  children?: ReactNode;
  /** CA extension: click handler (Phase 0 — no-op) */
  onClick?: (...args: any[]) => void;
  /** CA extension: mouse down handler */
  onMouseDown?: (...args: any[]) => void;
  /** CA extension: mouse up handler */
  onMouseUp?: (...args: any[]) => void;
  /** CA extension: mouse drag handler */
  onMouseDrag?: (...args: any[]) => void;
  /** CA extension: mouse enter handler */
  onMouseEnter?: (...args: any[]) => void;
  /** CA extension: mouse leave handler */
  onMouseLeave?: (...args: any[]) => void;
  /** CA extension: opaque background fill */
  opaque?: boolean;
}

/**
 * Box component — wraps ink v7 Box, strips CA-specific mouse event props.
 * Uses forwardRef for React 19 ref compatibility.
 */
const Box = forwardRef<unknown, BoxProps>(({ onClick, onMouseDown, onMouseUp, onMouseDrag, onMouseEnter, onMouseLeave, opaque, ...props }, _ref) => {
  // Phase 0: mouse events and opaque not supported — silently stripped
  void onClick; void onMouseDown; void onMouseUp; void onMouseDrag; void onMouseEnter; void onMouseLeave; void opaque;
  return <InkBox {...props} ref={_ref as any} />;
});
Box.displayName = 'Box';

export default Box;
