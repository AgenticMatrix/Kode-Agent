import React from 'react';
import { Box, Text } from 'ink';
import type { ToolUseRendererProps } from '../types.js';

export function TaskGetRenderer(props: ToolUseRendererProps): React.ReactNode {
  const taskId = props.input.taskId as string | undefined;
  const isDone = props.state === 'done';
  const status = props.result?.metadata?.status as string | undefined;

  const label = taskId ? `#${taskId}${status ? ` · ${status}` : ''}` : '';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text color={isDone ? 'green' : 'yellow'}>{isDone ? '●' : '○'} </Text>
        <Text bold>TaskGet</Text>
        {label ? <Text dimColor> · {label}</Text> : null}
      </Text>
    </Box>
  );
}
