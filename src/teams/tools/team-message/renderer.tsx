import React from 'react';
import { Box, Text } from 'ink';
import type { ToolUseRendererProps } from '../../../tools/types.js';

export function TeamMessageRenderer(props: ToolUseRendererProps): React.ReactNode {
  const to = props.input.to as string | undefined;
  const text = props.input.text as string | undefined;
  const isDone = props.state === 'done';
  const indicator = isDone ? '●' : '○';
  const color = isDone ? 'green' : 'magenta';

  const preview = text ? (text.length > 40 ? text.slice(0, 37) + '...' : text) : '';

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={color}>{indicator} </Text>
        <Text bold>TeamMessage</Text>
        {to ? <Text dimColor> → {to}</Text> : null}
        {preview ? <Text dimColor>: {preview}</Text> : null}
      </Text>
    </Box>
  );
}
