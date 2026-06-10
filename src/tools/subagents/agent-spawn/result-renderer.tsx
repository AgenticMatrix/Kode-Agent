import React from 'react';
import { Box, Text } from 'ink';
import { ShellTimeDisplay } from '../../shared/ShellTimeDisplay.js';
import type { ToolResultRendererProps } from '../../types.js';

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

export function AgentSpawnResultRenderer(props: ToolResultRendererProps): React.ReactNode {
  const { content, isError, duration } = props;
  const agentType = (props.metadata?.agentType as string) ?? 'general-purpose';
  const icon = AGENT_ICONS[agentType] ?? '🤖';
  const label = AGENT_LABELS[agentType] ?? agentType;

  const lines = content ? content.split('\n') : [];
  const collapseThreshold = 12;
  const tooLong = lines.length > collapseThreshold;
  const displayLines = tooLong ? lines.slice(0, collapseThreshold) : lines;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={isError ? 'red' : 'grey'}
      borderDimColor
      paddingX={1}
      width="90%"
    >
      {/* Header: icon + agent type | duration */}
      <Box flexDirection="row" justifyContent="space-between">
        <Text dimColor>
          {icon} <Text dimColor>{label}</Text>
        </Text>
        {duration !== undefined ? <ShellTimeDisplay durationMs={duration} /> : null}
      </Box>

      {/* Result content */}
      <Box paddingLeft={1} flexDirection="column">
        {displayLines.length === 0 ? (
          <Text color={isError ? 'red' : 'green'} dimColor>
            {isError ? '(error — no output)' : 'Done'}
          </Text>
        ) : (
          displayLines.map((line, i) => (
            <Text key={i} color={isError ? 'red' : 'white'}>
              {line}
            </Text>
          ))
        )}
        {tooLong && (
          <Text dimColor>
            ... {lines.length - collapseThreshold} more lines
          </Text>
        )}
      </Box>
    </Box>
  );
}
