import { Box, Text } from 'ink';
import type { SubagentType, SubagentState } from '../../../types.js';

export interface SubagentBlockRendererProps {
  agentType: SubagentType;
  agentName: string;
  state: SubagentState;
  messageCount?: number;
}

const AGENT_ICON: Record<SubagentType, string> = {
  explore: '🧭',
  plan: '📋',
  'general-purpose': '🔧',
  verification: '✅',
};

const AGENT_LABEL: Record<SubagentType, string> = {
  explore: 'Explore',
  plan: 'Plan',
  'general-purpose': 'Agent',
  verification: 'Verify',
};

const STATE_ICON: Record<SubagentState, string> = {
  running: '⏳',
  done: '✅',
  error: '❌',
};

const STATE_COLOR: Record<SubagentState, string> = {
  running: 'yellow',
  done: 'green',
  error: 'red',
};

/**
 * Renders a sub-agent block.
 *
 * 🧭 Explore · searching files... ⏳
 * 🧭 Explore · done ✅ (12 messages)
 */
export function SubagentBlockRenderer({
  agentType,
  agentName,
  state,
  messageCount,
}: SubagentBlockRendererProps) {
  const icon = AGENT_ICON[agentType] ?? '🤖';
  const label = AGENT_LABEL[agentType] ?? agentType;
  const stateIcon = STATE_ICON[state];
  const stateColor = STATE_COLOR[state];

  return (
    <Box
      flexDirection="row"
      marginBottom={1}
      paddingLeft={1}
    >
      <Text>
        <Text bold>{icon} {label}</Text>
        {agentName ? <Text dimColor> · {agentName}</Text> : null}
        <Text> </Text>
        <Text color={stateColor}>{stateIcon} {state}</Text>
        {messageCount !== undefined ? (
          <Text dimColor> ({messageCount} messages)</Text>
        ) : null}
      </Text>
    </Box>
  );
}
