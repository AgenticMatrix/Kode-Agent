import React from 'react';
import { Box, Text } from 'ink';
import type { ToolUseRendererProps } from '../../../tools/types.js';

export function TeamStatusRenderer(props: ToolUseRendererProps): React.ReactNode {
  const teamName = props.input.team_name as string | undefined;
  const isDone = props.state === 'done';
  const indicator = isDone ? '●' : '○';
  const color = isDone ? 'green' : 'cyan';

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={color}>{indicator} </Text>
        <Text bold>TeamStatus</Text>
        {teamName ? <Text dimColor> · {teamName}</Text> : <Text dimColor> · listing all</Text>}
      </Text>
    </Box>
  );
}
