import React from 'react';
import { Box, Text } from 'ink';
import type { ToolUseRenderer } from '../../types.js';

export const AgentSpawnRenderer: ToolUseRenderer = (props) => {
  const prompt = props.input.prompt as string ?? '';
  const agentType = props.input.agent_type as string ?? 'general-purpose';
  const summary = prompt.length > 80 ? prompt.slice(0, 77) + '...' : prompt;

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: props.state === 'executing' ? 'yellow' : props.state === 'error' ? 'red' : 'blue',
      paddingX: 1,
    },
    React.createElement(Text, { bold: true, color: 'cyan' }, `agent-spawn (${agentType})`),
    React.createElement(Text, { dimColor: true }, summary),
    props.state === 'executing' && React.createElement(Text, { color: 'yellow' }, '  Running...'),
    props.state === 'done' && props.result && React.createElement(Text, { color: 'green' }, '  Done'),
    props.state === 'error' && props.result?.isError && React.createElement(Text, { color: 'red' }, `  Error: ${props.result.content.slice(0, 100)}`),
  );
};
