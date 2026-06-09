import React from 'react';
import { Text } from 'ink';

export interface OutputLineProps {
  line: string;
  isStderr?: boolean;
}

/**
 * Strip ANSI escape sequences with a simple regex.
 * Avoids the `strip-ansi` dependency by targeting common SGR codes.
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Attempt to pretty-print a single line as JSON.
 * Returns the original line if it doesn't look like JSON or parsing fails.
 */
function tryFormatJson(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return line;
  if (trimmed.length > 10_000) return line; // skip huge blobs

  try {
    const parsed = JSON.parse(trimmed);
    // Verify round-trip: if precision was lost, return original
    const stringified = JSON.stringify(parsed, null, 2);
    const normalizedOriginal = trimmed.replace(/\s+/g, '');
    const normalizedFormatted = stringified.replace(/\s+/g, '');
    if (normalizedOriginal !== normalizedFormatted) return line;
    return stringified;
  } catch {
    return line;
  }
}

/**
 * Single output line renderer.
 *
 * Features:
 *  - Strips ANSI escape sequences
 *  - Auto-detects and pretty-prints JSON lines
 *  - Stderr lines render in dim yellow; stdout in default white
 */
export function OutputLine({ line, isStderr }: OutputLineProps): React.ReactNode {
  const cleaned = stripAnsi(line);
  const formatted = tryFormatJson(cleaned);

  if (!formatted.trim()) return null;

  const color = isStderr ? 'yellow' : undefined;

  // JSON output — split into lines so multi-line JSON renders correctly
  const jsonLines = formatted.split('\n');
  if (jsonLines.length > 1) {
    return (
      <React.Fragment>
        {jsonLines.map((l, i) => (
          <Text key={i} color={color} dimColor={isStderr && color === 'yellow'}>
            {l || ' '}
          </Text>
        ))}
      </React.Fragment>
    );
  }

  return (
    <Text color={color} dimColor={isStderr}>
      {formatted}
    </Text>
  );
}
