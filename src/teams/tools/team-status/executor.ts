import type { ToolExecutor } from '../../../tools/types.js';
import { loadTeamConfig, listTeams } from '../../team-store.js';
import { getUnreadCount } from '../../team-mailbox.js';

export const execute: ToolExecutor = async (input, options) => {
  const teamName = input.team_name as string | undefined;

  // ── List all teams ──────────────────────────────────────────────────
  if (!teamName) {
    const teams = await listTeams();
    if (teams.length === 0) {
      return {
        content: 'No teams found. Use team-create to create one.',
        isError: false,
      };
    }

    const summaries = await Promise.all(
      teams.map(async (name) => {
        const cfg = await loadTeamConfig(name);
        if (!cfg) return null;
        const running = cfg.members.filter(m => m.status === 'running').length;
        const done = cfg.members.filter(m => m.status === 'done').length;
        return `- **${cfg.name}**: ${cfg.members.length} members (${running} running, ${done} done) — ${cfg.description}`;
      }),
    );

    return {
      content: `## Teams\n\n${summaries.filter(Boolean).join('\n')}`,
      isError: false,
    };
  }

  // ── Single team detail ──────────────────────────────────────────────
  const config = await loadTeamConfig(teamName);
  if (!config) {
    return {
      content: `Team '${teamName}' not found. Available teams: ${(await listTeams()).join(', ') || 'none'}`,
      isError: true,
    };
  }

  // Merge with live SubAgentRegistry status
  const subAgentReg = options.agentSpawn?.subAgentRegistry;

  const memberLines = await Promise.all(
    config.members.map(async (m) => {
      const live = subAgentReg?.get(m.agentId);
      const status = live?.status ?? m.status;
      const unread = await getUnreadCount(teamName, m.name).catch(() => 0);
      const unreadNote = unread > 0 ? ` (${unread} unread)` : '';
      const taskNote = m.task ? ` — ${m.task}` : '';
      return `  - **${m.name}** (${m.agentType}) [${status}]${unreadNote}${taskNote}`;
    }),
  );

  const lines = [
    `## Team: ${config.name}`,
    `**Description**: ${config.description}`,
    `**Created**: ${new Date(config.createdAt).toISOString()}`,
    `**Members**:`,
    ...memberLines,
  ];

  return {
    content: lines.join('\n'),
    isError: false,
    metadata: { teamName, memberCount: config.members.length },
  };
};
