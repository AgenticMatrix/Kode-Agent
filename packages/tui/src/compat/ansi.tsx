/**
 * Ansi compat stub — Phase 0
 *
 * Renders ANSI-escape-code-enriched text. Phase 0 passes content
 * through as plain text; full ANSI parsing deferred.
 */
import React from 'react';
import { Text } from 'ink';

export interface AnsiProps {
  children?: string;
  /** Additional props */
  [key: string]: unknown;
}

export function Ansi({ children, ...rest }: AnsiProps): React.ReactElement {
  // Phase 0 stub: render the string directly.
  // Full ANSI escape sequence parsing will be added later.
  return <Text {...rest}>{children ?? ''}</Text>;
}

export default Ansi;
