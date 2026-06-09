import { Box, Text } from 'ink';
import type { TurnSummary } from '../../../types.js';

export interface TurnBoundaryRendererProps {
  turnId: number;
  summary?: TurnSummary;
}

/**
 * Renders a turn boundary separator.
 *
 * ──── Turn 3 ✓ · 2 tools · 🔧 Read, ✏️ Edit · ⏱ 4.2s ────
 */
export function TurnBoundaryRenderer({ turnId, summary }: TurnBoundaryRendererProps) {
  const parts: string[] = [`Turn ${turnId}`];

  if (summary) {
    parts.push(summary.outcome === 'success' ? '✓' : summary.outcome === 'error' ? '✗' : '·');
    if (summary.toolCount > 0) {
      parts.push(`${summary.toolCount} tools`);
    }
    if (summary.duration > 0) {
      const secs = (summary.duration / 1000).toFixed(1);
      parts.push(`⏱ ${secs}s`);
    }
  }

  const line = `──── ${parts.join(' · ')} ────`;

  return (
    <Box flexDirection="row" marginBottom={1} marginTop={0}>
      <Text dimColor color="grey">{line}</Text>
    </Box>
  );
}
