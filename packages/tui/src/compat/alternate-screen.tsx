/**
 * AlternateScreen compat stub — Phase 0
 *
 * Manages the terminal alternate screen buffer (DEC 1049).
 * Phase 0 renders children in a simple Box; full alt-screen
 * management will be implemented later.
 */
import React from 'react';
import { Box } from 'ink';

export type MouseTrackingMode = 'off' | 'wheel' | 'buttons' | 'all';

export interface AlternateScreenProps {
  children?: React.ReactNode;
  /** Mouse tracking mode in the alt-screen */
  mouseTracking?: MouseTrackingMode;
  /** Additional props */
  [key: string]: unknown;
}

export function AlternateScreen({
  children,
  mouseTracking = 'off',
  ...rest
}: AlternateScreenProps): React.ReactElement {
  // Phase 0 stub: render children in a full-height Box.
  // Full alternate-screen buffer management (DEC 1049 enter/exit,
  // mouse tracking control) will be implemented in a later phase.
  return (
    <Box flexDirection="column" height="100%" {...rest}>
      {children}
    </Box>
  );
}

export default AlternateScreen;
