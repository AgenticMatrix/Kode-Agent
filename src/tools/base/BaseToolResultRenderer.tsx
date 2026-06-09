import { Box, Text } from 'ink';
import type { ToolResultRendererProps } from '../types.js';

/**
 * Common base for all tool result renderers.
 *
 * Renders:
 *  - stdout in white / stderr in red
 *  - auto-collapse long output (default >5 lines) with "... N more lines"
 *  - truncation indicator
 *  - error highlight
 */
export function BaseToolResultRenderer({
  content,
  isError,
  truncated,
  collapseThreshold = 5,
}: ToolResultRendererProps) {
  const lines = content.split('\n');
  const tooLong = lines.length > collapseThreshold;
  const displayLines = tooLong ? lines.slice(0, collapseThreshold) : lines;
  const displayText = displayLines.join('\n');

  return (
    <Box flexDirection="column">
      <Text color={isError ? 'red' : 'white'}>
        {displayText || (isError ? '(error — no output)' : '(empty)')}
      </Text>
      {tooLong && (
        <Text dimColor>
          ... {lines.length - collapseThreshold} more lines
        </Text>
      )}
      {truncated && (
        <Text dimColor color="yellow">
          (output truncated)
        </Text>
      )}
    </Box>
  );
}
