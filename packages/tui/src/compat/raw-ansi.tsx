/**
 * RawAnsi compat stub — Phase 0
 *
 * Bypass renderer — renders pre-computed ANSI strings directly.
 * Phase 0 passes content through as plain text; full implementation deferred.
 */
import React from 'react';
import { Text } from 'ink';

export interface RawAnsiProps {
  children?: string;
  /** Additional props */
  [key: string]: unknown;
}

export function RawAnsi({ children, ...rest }: RawAnsiProps): React.ReactElement {
  // Phase 0 stub: render the pre-computed ANSI string directly as Text.
  // When fully implemented, this will bypass the normal rendering pipeline.
  return <Text {...rest}>{children ?? ''}</Text>;
}

export default RawAnsi;
