import React from 'react';
import { Box, Text } from 'ink';
import type { ToolUseRenderer } from '../../types.js';

export const AgentReadRenderer: ToolUseRenderer = (props) => {
  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: 'blue',
      paddingX: 1,
      width: '90%',
    },
    React.createElement(Text, { bold: true, color: 'cyan' }, 'agent-read'),
    props.input.list_all
      ? React.createElement(Text, { dimColor: true }, 'Listing all sub-agents')
      : React.createElement(Text, { dimColor: true }, `Querying: ${props.input.agent_id ?? '?'}`),
    props.state === 'done' && props.result && React.createElement(Text, {}, props.result.content.slice(0, 200)),
  );
};
