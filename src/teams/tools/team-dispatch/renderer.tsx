import React from 'react';
import { Box, Text } from 'ink';
import type { ToolUseRendererProps } from '../../../tools/types.js';

export function TeamDispatchRenderer(props: ToolUseRendererProps): React.ReactNode {
  const teamName = props.input.team_name as string | undefined;
  const members = (props.input.members as string[] | undefined) ?? [];
  const isDone = props.state === 'done';
  const isExecuting = props.state === 'executing';
  const indicator = isDone ? '●' : isExecuting ? '◉' : '○';
  const color = isDone ? 'green' : 'yellow';

  const detail = members.length > 0
    ? members.join(', ')
    : 'all pending';

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={color}>{indicator} </Text>
        <Text bold>TeamDispatch</Text>
        {teamName ? <Text dimColor> · {teamName}</Text> : null}
        <Text dimColor> ({detail})</Text>
        {isExecuting ? <Text dimColor color="yellow"> spawning...</Text> : null}
      </Text>
    </Box>
  );
}
