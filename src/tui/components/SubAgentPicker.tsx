import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { getSubAgentRegistry } from '../../subagents/agent-spawn/registry-ref.js';

const AGENT_ICONS: Record<string, string> = {
  explore: '🔍',
  plan: '📋',
  'general-purpose': '🔧',
};

interface SubAgentPickerProps {
  onSelect: (agentId: string) => void;
  onCancel: () => void;
}

export function SubAgentPicker({ onSelect, onCancel }: SubAgentPickerProps) {
  const registry = getSubAgentRegistry();
  const agents = registry?.list() ?? [];
  const [sel, setSel] = useState(0);

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      const agent = agents[sel];
      if (agent) onSelect(agent.id);
      return;
    }

    if (key.upArrow && sel > 0) {
      setSel((s) => s - 1);
      return;
    }

    if (key.downArrow && sel < agents.length - 1) {
      setSel((s) => s + 1);
      return;
    }

    // Number keys quick-pick
    const n = parseInt(_input, 10);
    if (n >= 1 && n <= agents.length) {
      const agent = agents[n - 1];
      if (agent) onSelect(agent.id);
    }
  });

  if (agents.length === 0) {
    return (
      <Box borderStyle="double" borderColor="cyan" flexDirection="column" paddingX={1}>
        <Text bold color="cyan">Sub-agents</Text>
        <Text dimColor>No sub-agents in this session.</Text>
        <Text dimColor>Sub-agents are created when the main agent uses agent-spawn.</Text>
        <Text dimColor>Press Esc to close.</Text>
      </Box>
    );
  }

  return (
    <Box borderStyle="double" borderColor="cyan" flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        Sub-agents ({agents.length}) — select one to view transcript
      </Text>

      <Text>{' '}</Text>

      {agents.map((a, i) => {
        const icon = AGENT_ICONS[a.agentType] ?? '🤖';
        const elapsed = a.finishedAt
          ? `${((a.finishedAt - a.createdAt) / 1000).toFixed(1)}s`
          : 'running';
        const isSelected = sel === i;

        return (
          <Text key={a.id}>
            <Text
              bold={isSelected}
              color={isSelected ? 'cyan' : undefined}
              dimColor={!isSelected}
              inverse={isSelected}
            >
              {isSelected ? '> ' : '  '}
              {i + 1}. {icon} {a.agentType}
              {'  '}{a.status}
              {'  '}{a.turnCount}t/{a.toolCount}tools
              {'  '}{elapsed}
              {'  '}{a.id}
            </Text>
          </Text>
        );
      })}

      <Text>{' '}</Text>
      <Text dimColor>
        Up/Down select · Enter confirm · 1-9 quick pick · Esc cancel
      </Text>
    </Box>
  );
}
