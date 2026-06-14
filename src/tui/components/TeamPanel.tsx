import { useEffect, useState, useRef } from 'react';
import { Box, Text } from 'ink';
import { listTeams, loadTeamConfig } from '../../teams/team-store.js';
import { getSubAgentRegistry } from '../../agents/agent-spawn/registry-ref.js';
import type { TeamConfig, TeamMember } from '../../teams/types.js';

interface TeamPanelProps {
  dismissed: boolean;
  onDismissReset?: () => void;
}

const POLL_INTERVAL_MS = 2000;

const STATUS_ICON: Record<string, string> = {
  pending: '○',
  running: '◉',
  done: '●',
  error: '✕',
  stopped: '■',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'grey',
  running: 'yellow',
  done: 'green',
  error: 'red',
  stopped: 'grey',
};

const AGENT_COLOR: Record<string, string> = {
  explore: 'blue',
  plan: 'magenta',
  'general-purpose': 'cyan',
};

function memberLabel(m: TeamMember): string {
  const task = m.task ? ` — ${m.task}` : '';
  return `${m.name} ${task}`.slice(0, 60);
}

/**
 * Team status panel pinned above the input box.
 * Read-only display — press Ctrl+J to open the TeamAgentPicker
 * for selecting a member to view their transcript.
 */
export function TeamPanel({ dismissed, onDismissReset }: TeamPanelProps) {
  const [configs, setConfigs] = useState<TeamConfig[]>([]);
  const prevActiveCount = useRef(0);
  const hiddenTeams = useRef<Set<string>>(new Set());
  const prevFingerprint = useRef('');

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const registry = getSubAgentRegistry();
        const names = await listTeams();
        const loaded: TeamConfig[] = [];
        for (const name of names) {
          const cfg = await loadTeamConfig(name);
          if (cfg) {
            // Only show members whose agents exist in the in-memory registry.
            // Disk configs persist across sessions, but the registry does not.
            const liveMembers = cfg.members.filter((m) => {
              if (m.agentId.startsWith('pending-')) return true;
              if (m.status === 'done' || m.status === 'error' || m.status === 'stopped') return false;
              return registry ? registry.get(m.agentId) !== undefined : false;
            });
            if (liveMembers.length > 0) {
              loaded.push({ ...cfg, members: liveMembers });
            }
          }
        }
        if (!active) return;

        const fp = loaded.map(c => `${c.name}:${c.members.map(m => `${m.name}:${m.status}:${m.agentId}`).join(',')}`).join('|');
        if (fp !== prevFingerprint.current) {
          prevFingerprint.current = fp;
          setConfigs(loaded);
        }

        const activeCount = loaded.reduce(
          (sum, c) => sum + c.members.filter(m => m.status === 'running' || m.status === 'pending').length,
          0,
        );

        if (activeCount === 0 && prevActiveCount.current > 0) {
          for (const c of loaded) hiddenTeams.current.add(c.name);
        }

        if (activeCount > prevActiveCount.current && activeCount > 0) {
          if (dismissed) onDismissReset?.();
          if (prevActiveCount.current === 0) {
            hiddenTeams.current = new Set();
          }
        }

        prevActiveCount.current = activeCount;
      } catch {
        // Silently ignore poll errors
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [dismissed, onDismissReset]);

  if (dismissed) return null;

  const visible = configs.filter(c => !hiddenTeams.current.has(c.name));
  if (visible.length === 0) return null;

  const allMembers = visible.flatMap(c => c.members);
  const hasActive = allMembers.some(m => m.status === 'running' || m.status === 'pending');

  // Sort: running → pending → done → error → stopped
  const sorted = [...allMembers].sort((a, b) => {
    const order: Record<string, number> = { running: 0, pending: 1, done: 2, error: 3, stopped: 4 };
    return (order[a.status] ?? 2) - (order[b.status] ?? 2);
  });

  const runningCount = allMembers.filter(m => m.status === 'running').length;
  const pendingCount = allMembers.filter(m => m.status === 'pending').length;
  const doneCount = allMembers.filter(m => m.status === 'done').length;
  const errorCount = allMembers.filter(m => m.status === 'error').length;

  const parts: string[] = [];
  if (runningCount > 0) parts.push(`${runningCount} active`);
  if (pendingCount > 0) parts.push(`${pendingCount} pending`);
  if (doneCount > 0) parts.push(`${doneCount} done`);
  if (errorCount > 0) parts.push(`${errorCount} error`);

  return (
    <Box flexDirection="column" flexShrink={0} alignSelf="flex-start" paddingX={1} borderStyle="single" borderColor="grey">
      <Box>
        <Text bold>Team </Text>
        {visible.length === 1 ? (
          <Text dimColor>{visible[0].name} </Text>
        ) : (
          <Text dimColor>({visible.length} teams) </Text>
        )}
        <Text dimColor>({parts.join(', ')})</Text>
        {hasActive && <Text dimColor> — Ctrl+K to pick member</Text>}
      </Box>

      {sorted.slice(0, 8).map((m) => {
        const icon = STATUS_ICON[m.status] ?? '?';
        const color = STATUS_COLOR[m.status] ?? 'grey';
        const agentColor = AGENT_COLOR[m.agentType] ?? 'white';
        const label = memberLabel(m);

        return (
          <Box key={`${m.name}-${m.agentId}`} flexShrink={0}>
            <Text>{'  '}</Text>
            <Text color={color}>{icon} </Text>
            <Text color={agentColor}>{m.agentType}</Text>
            <Text dimColor> · </Text>
            <Text dimColor={m.status === 'done'}>{label}</Text>
          </Box>
        );
      })}

      {sorted.length > 8 && (
        <Box>
          <Text dimColor>  ... and {sorted.length - 8} more</Text>
        </Box>
      )}
    </Box>
  );
}
