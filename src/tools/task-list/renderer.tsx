import React from 'react';
import { Box, Text } from 'ink';
import type { ToolUseRendererProps } from '../types.js';

export function TaskListRenderer(props: ToolUseRendererProps): React.ReactNode {
  const isDone = props.state === 'done';
  const result = props.result;
  const count = props.state === 'done' && result?.metadata?.count !== undefined
    ? `${result.metadata.count} task(s)`
    : '';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text color={isDone ? 'green' : 'yellow'}>{isDone ? '●' : '○'} </Text>
        <Text bold>TaskList</Text>
        {count ? <Text dimColor> · {count}</Text> : null}
      </Text>
    </Box>
  );
}
