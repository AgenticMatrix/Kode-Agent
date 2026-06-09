import React from 'react';
import { Box, Text } from 'ink';
import type { ToolUseRendererProps } from '../types.js';

export function TaskUpdateRenderer(props: ToolUseRendererProps): React.ReactNode {
  const taskId = props.input.taskId as string | undefined;
  const status = props.input.status as string | undefined;
  const isDone = props.state === 'done';

  const label = status ? `${status}` : taskId ? `#${taskId}` : '';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text color={isDone ? 'green' : 'yellow'}>{isDone ? '●' : '○'} </Text>
        <Text bold>TaskUpdate</Text>
        {label ? <Text dimColor> · {label}</Text> : null}
      </Text>
    </Box>
  );
}
