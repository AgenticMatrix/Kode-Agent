import { Box, Text } from 'ink';

export interface CompactionBoundaryRendererProps {
  removedCount: number;
  reason: string;
}

/**
 * Renders a context compaction boundary.
 *
 * ── 📦 Context compacted · 14 messages removed · reason ──
 */
export function CompactionBoundaryRenderer({
  removedCount,
  reason,
}: CompactionBoundaryRendererProps) {
  return (
    <Box flexDirection="row" marginBottom={1} marginTop={0}>
      <Text dimColor color="yellow">
        ── 📦 Context compacted · {removedCount} messages removed · {reason} ──
      </Text>
    </Box>
  );
}
