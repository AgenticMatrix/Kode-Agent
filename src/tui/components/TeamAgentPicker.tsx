import { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { listTeams, loadTeamConfig } from '../../teams/team-store.js';
import { getSubAgentRegistry } from '../../agents/agent-spawn/registry-ref.js';
import type { TeamMember } from '../../teams/types.js';

const AGENT_ICONS: Record<string, string> = {
  explore: '\u{1F50D}',
  plan: '\u{1F4CB}',
  'general-purpose': '\u{1F527}',
};

const STATUS_ICON: Record<string, string> = {
  running: '◉',
  done: '●',
  error: '✕',
  stopped: '■',
};

const STATUS_COLOR: Record<string, string> = {
  running: 'yellow',
  done: 'green',
  error: 'red',
  stopped: 'grey',
};

interface SelectableMember {
  member: TeamMember;
  teamName: string;
}

interface TeamAgentPickerProps {
  onSelect: (agentId: string) => void;
  onCancel: () => void;
}

/**
 * Overlay picker for selecting a team member to view their transcript.
 * Shows all selectable team members (running or done, with valid agentIds).
 *
 * Keyboard:
 *   Up/Down  — navigate
 *   Enter    — select (open transcript)
 *   Esc      — cancel
 *   1-9      — quick pick
 */
export function TeamAgentPicker({ onSelect, onCancel }: TeamAgentPickerProps) {
  const [members, setMembers] = useState<SelectableMember[]>([]);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    async function load() {
      const registry = getSubAgentRegistry();
      const names = await listTeams();
      const result: SelectableMember[] = [];
      for (const name of names) {
        const cfg = await loadTeamConfig(name);
        if (!cfg) continue;
        for (const m of cfg.members) {
          if (
            (m.status === 'running' || m.status === 'done') &&
            !m.agentId.startsWith('pending-') &&
            registry?.get(m.agentId)
          ) {
            result.push({ member: m, teamName: name });
          }
        }
      }
      setMembers(result);
    }
    load();
  }, []);

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      const item = members[sel];
      if (item) onSelect(item.member.agentId);
      return;
    }

    if (key.upArrow && sel > 0) {
      setSel(s => s - 1);
      return;
    }

    if (key.downArrow && sel < members.length - 1) {
      setSel(s => s + 1);
      return;
    }

    // Number keys quick-pick
    const n = parseInt(_input, 10);
    if (n >= 1 && n <= members.length) {
      const item = members[n - 1];
      if (item) onSelect(item.member.agentId);
    }
  });

  if (members.length === 0) {
    return (
      <Box borderStyle="double" borderColor="cyan" flexDirection="column" paddingX={1}>
        <Text bold color="cyan">Team Members</Text>
        <Text dimColor>No selectable team members.</Text>
        <Text dimColor>Create a team with team-create, then dispatch members with team-dispatch.</Text>
        <Text dimColor>Active members will appear here automatically.</Text>
        <Text>{' '}</Text>
        <Text dimColor>Press Esc to close.</Text>
      </Box>
    );
  }

  return (
    <Box borderStyle="double" borderColor="cyan" flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        Team Members ({members.length}) — select to view transcript
      </Text>

      <Text>{' '}</Text>

      {members.map((item, i) => {
        const { member: m, teamName } = item;
        const icon = AGENT_ICONS[m.agentType] ?? '\u{1F916}';
        const statusIcon = STATUS_ICON[m.status] ?? '?';
        const statusColor = STATUS_COLOR[m.status] ?? 'white';
        const isSelected = sel === i;
        const label = m.task ? `${m.task.slice(0, 50)}` : m.name;

        return (
          <Text key={`${teamName}-${m.agentId}`}>
            <Text
              bold={isSelected}
              color={isSelected ? 'cyan' : undefined}
              inverse={isSelected}
            >
              {isSelected ? '> ' : '  '}
              {i + 1}. {icon} {m.name}
              {'  '}
              <Text color={statusColor}>{statusIcon} {m.status}</Text>
              {'  '}
              <Text dimColor>{m.agentType}</Text>
              {'  '}
              <Text dimColor>{teamName}</Text>
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
