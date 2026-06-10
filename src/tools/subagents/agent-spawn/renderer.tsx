import React from 'react';
import { Box, Text } from 'ink';
import { ShellTimeDisplay } from '../../shared/ShellTimeDisplay.js';
import type { ToolUseRenderer } from '../../types.js';

const AGENT_ICONS: Record<string, string> = {
  explore: '🔍',
  plan: '📋',
  'general-purpose': '🔧',
};

const AGENT_LABELS: Record<string, string> = {
  explore: 'Explore',
  plan: 'Plan',
  'general-purpose': 'General-purpose',
};

const RESULT_COLLAPSE = 12;

export const AgentSpawnRenderer: ToolUseRenderer = (props) => {
  // Don't render a placeholder while the LLM is still streaming the input.
  if (props.state === 'pending') return null;

  const prompt = props.input.prompt as string ?? '';
  const agentType = props.input.agent_type as string ?? 'general-purpose';
  const icon = AGENT_ICONS[agentType] ?? '🤖';
  const label = AGENT_LABELS[agentType] ?? agentType;
  const summary = prompt.length > 80 ? prompt.slice(0, 77) + '...' : prompt;

  const isDone = props.state === 'done';
  const resultContent: string | undefined = isDone ? (props.result?.content as string) : undefined;
  const resultLines = resultContent ? resultContent.split('\n') : [];
  const tooLong = resultLines.length > RESULT_COLLAPSE;
  const displayLines = tooLong ? resultLines.slice(0, RESULT_COLLAPSE) : resultLines;

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: props.state === 'executing' ? 'yellow' : props.state === 'error' ? 'red' : 'blue',
      paddingX: 1,
      width: '90%',
    },
    // Header: icon + label | duration
    React.createElement(
      Box,
      { flexDirection: 'row', justifyContent: 'space-between' },
      React.createElement(Text, { bold: true, color: 'cyan' }, `${icon} ${label}`),
      props.duration !== undefined && isDone
        ? React.createElement(ShellTimeDisplay, { durationMs: props.duration })
        : null,
    ),
    // Prompt summary
    React.createElement(Text, { dimColor: true }, summary),
    // Running indicator
    props.state === 'executing' && React.createElement(Text, { color: 'yellow' }, '  Running...'),
    // Done: show result content inside the same box
    isDone && resultLines.length > 0 && React.createElement(
      Box,
      { paddingLeft: 1, flexDirection: 'column', marginTop: 0 },
      ...displayLines.map((line, i) =>
        React.createElement(Text, { key: i, color: 'white' }, line),
      ),
      tooLong && React.createElement(
        Text,
        { dimColor: true },
        `... ${resultLines.length - RESULT_COLLAPSE} more lines`,
      ),
    ),
    isDone && resultLines.length === 0 && React.createElement(Text, { color: 'green' }, '  Done'),
    // Error
    props.state === 'error' && props.result?.isError &&
      React.createElement(Text, { color: 'red' }, `  Error: ${(props.result.content as string).slice(0, 100)}`),
  );
};
