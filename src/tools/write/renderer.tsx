import { Box, Text } from 'ink';
import { BaseToolRenderer } from '../base/BaseToolRenderer.js';
import type { ToolUseRendererProps } from '../types.js';

export function WriteRenderer(props: ToolUseRendererProps) {
  const fp = props.input.file_path as string | undefined;
  const content = props.input.content as string | undefined;
  const preview = content ? content.split('\n')[0]?.slice(0, 60) : undefined;

  return (
    <BaseToolRenderer {...props}>
      <Box flexDirection="column">
        {fp ? (
          <>
            <Box flexDirection="row">
              <Text dimColor>Writing </Text>
              <Text color="yellow">{fp}</Text>
            </Box>
            {preview ? (
              <Text dimColor>{preview}{content && content.split('\n')[0].length > 60 ? '...' : ''}</Text>
            ) : null}
          </>
        ) : (
          <Text dimColor>Writing file</Text>
        )}
      </Box>
    </BaseToolRenderer>
  );
}
