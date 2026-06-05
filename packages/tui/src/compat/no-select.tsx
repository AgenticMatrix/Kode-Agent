/**
 * NoSelect compat stub — Phase 0
 *
 * Simple Text wrapper that marks a region as non-selectable.
 * Full text-selection exclusion deferred to later phases.
 */
import React from 'react';
import { Text } from 'ink';

export interface NoSelectProps {
  children?: React.ReactNode;
  /** When set, excludes from left edge to the right boundary */
  from?: 'left-edge';
  /** CA extension: click handler (Phase 0 — no-op) */
  onClick?: (...args: any[]) => void;
  /** CA extension: mouse down handler */
  onMouseDown?: (...args: any[]) => void;
  /** CA extension: mouse up handler */
  onMouseUp?: (...args: any[]) => void;
  /** Additional props */
  [key: string]: unknown;
}

export function NoSelect({ children, onClick, onMouseDown, onMouseUp, ...rest }: NoSelectProps): React.ReactElement {
  // Phase 0 stub: render children in a dimmed Text wrapper
  void onClick; void onMouseDown; void onMouseUp;
  return (
    <Text dimColor {...rest}>
      {typeof children === 'string' ? children : null}
    </Text>
  );
}

export default NoSelect;
