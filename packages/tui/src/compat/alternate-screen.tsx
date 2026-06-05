/**
 * AlternateScreen compat stub — Phase 2
 *
 * Manages the terminal alternate screen buffer (DEC 1049) and provides
 * the MouseProvider context for SGR mouse event dispatching.
 * Phase 2: wraps children in MouseProvider; full alt-screen buffer
 * management (DEC 1049 enter/exit) deferred.
 */
import React from 'react';
import { Box } from 'ink';
import { MouseProvider } from './mouse-tracker.js';

export type MouseTrackingMode = 'off' | 'wheel' | 'buttons' | 'all';

export interface AlternateScreenProps {
  children?: React.ReactNode;
  /** Mouse tracking mode in the alt-screen */
  mouseTracking?: MouseTrackingMode;
  /** Additional props */
  [key: string]: unknown;
}

/**
 * AlternateScreen component — renders children in a full-height Box
 * wrapped in a MouseProvider.  This ensures all descendant Box,
 * ScrollBox, and NoSelect components can receive SGR mouse events
 * without any changes to CLI code.
 *
 * The `mouseTracking` prop is accepted but has no effect in Phase 2
 * (SGR tracking is managed reactively by the MouseProvider based on
 * registered handlers).
 */
export function AlternateScreen({
  children,
  mouseTracking = 'off',
  ...rest
}: AlternateScreenProps): React.ReactElement {
  void mouseTracking; // accepted, SGR managed by MouseProvider

  return (
    <MouseProvider>
      <Box flexDirection="column" height="100%" {...rest}>
        {children}
      </Box>
    </MouseProvider>
  );
}

export default AlternateScreen;
