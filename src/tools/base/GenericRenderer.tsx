import { Box, Text } from 'ink';
import { BaseToolRenderer, } from './BaseToolRenderer.js';
import { BaseToolResultRenderer } from './BaseToolResultRenderer.js';
import type { ToolUseRendererProps, ToolResultRendererProps } from '../types.js';

/**
 * Fallback renderer for any tool without a specialised renderer.
 */
export function GenericToolRenderer(props: ToolUseRendererProps) {
  return (
    <BaseToolRenderer {...props}>
      <Box flexDirection="column">
        <Text dimColor>
          Tool input: (specialised renderer not yet implemented)
        </Text>
      </Box>
    </BaseToolRenderer>
  );
}

/**
 * Fallback result renderer.
 */
export function GenericToolResultRenderer(props: ToolResultRendererProps) {
  return <BaseToolResultRenderer {...props} />;
}
