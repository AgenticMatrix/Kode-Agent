import { Box, Text } from 'ink';

export interface CompletionBoundaryRendererProps {
  stopReason: string;
}

const REASON_LABEL: Record<string, string> = {
  end_turn: 'Turn complete',
  max_tokens: 'Max tokens reached',
  stop_sequence: 'Stop sequence',
  tool_use: 'Tool use required',
};

/**
 * Renders a completion boundary (OCC feature).
 *
 * ✓ Turn complete (end_turn)
 */
export function CompletionBoundaryRenderer({ stopReason }: CompletionBoundaryRendererProps) {
  const label = REASON_LABEL[stopReason] ?? stopReason;

  return (
    <Box flexDirection="row" marginBottom={1} marginTop={0}>
      <Text dimColor color="green">
        ✓ {label}
        <Text dimColor color="grey"> ({stopReason})</Text>
      </Text>
    </Box>
  );
}
