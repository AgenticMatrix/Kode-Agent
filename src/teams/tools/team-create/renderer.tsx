import React from 'react';
import { Box, Text } from 'ink';
import type { ToolUseRendererProps } from '../../../tools/types.js';

export function TeamCreateRenderer(props: ToolUseRendererProps): React.ReactNode {
  const name = props.input.name as string | undefined;
  const members = (props.input.members as any[] | undefined) ?? [];
  const isDone = props.state === 'done';
  const indicator = isDone ? '●' : '○';
  const color = isDone ? 'green' : 'yellow';

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={color}>{indicator} </Text>
        <Text bold>TeamCreate</Text>
        {name ? <Text dimColor> · {name}</Text> : null}
        {members.length > 0 ? <Text dimColor> ({members.length} members)</Text> : null}
      </Text>
    </Box>
  );
}
