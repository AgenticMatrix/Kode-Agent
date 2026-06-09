import React from 'react';
import { Text } from 'ink';

export interface ShellTimeDisplayProps {
  durationMs: number;
}

/**
 * Format a millisecond duration into a human-readable string.
 *
 *  - < 1000ms: shows "450ms"
 *  - >= 1000ms: shows "1.2s"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Small duration badge component.
 *
 * Renders `⏱ 1.2s` in dim text.
 */
export function ShellTimeDisplay({ durationMs }: ShellTimeDisplayProps): React.ReactNode {
  return (
    <Text dimColor>
      {'⏱'} {formatDuration(durationMs)}
    </Text>
  );
}
