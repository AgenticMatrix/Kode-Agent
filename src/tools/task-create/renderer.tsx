import React from 'react';
import { Box, Text } from 'ink';
import type { ToolUseRendererProps } from '../types.js';

export function TaskCreateRenderer(props: ToolUseRendererProps): React.ReactNode {
  const subject = props.input.subject as string | undefined;
  const isDone = props.state === 'done';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text color={isDone ? 'green' : 'yellow'}>{isDone ? '●' : '○'} </Text>
        <Text bold>TaskCreate</Text>
        {subject ? <Text dimColor> · {subject}</Text> : null}
      </Text>
    </Box>
  );
}
