import type { ToolExecutor } from '../../../tools/types.js';
import { loadTeamConfig, saveTeamConfig, sanitizeTeamName } from '../../team-store.js';
import type { TeamConfig, TeamMember } from '../../types.js';

function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const execute: ToolExecutor = async (input, options) => {
  const rawName = input.name as string;
  const description = input.description as string;
  const membersInput = (input.members as any[] | undefined) ?? [];

  if (!rawName || !description) {
    return { content: 'Error: name and description are required.', isError: true };
  }

  const name = sanitizeTeamName(rawName);

  const existing = await loadTeamConfig(name);
  if (existing) {
    return {
      content: `Team '${name}' already exists. Use team-status to view it, or team-dispatch to activate its members.`,
      isError: true,
    };
  }

  const members: TeamMember[] = membersInput.map(m => ({
    agentId: `pending-${shortId()}`,
    name: m.name as string,
    agentType: m.agent_type as string,
    model: m.model as string | undefined,
    status: 'pending' as const,
    task: m.task as string,
    joinedAt: Date.now(),
  }));

  const config: TeamConfig = {
    name,
    description,
    createdAt: Date.now(),
    leadSessionId: options.sessionId,
    members,
  };

  await saveTeamConfig(config);

  const memberList = members.length > 0
    ? `\n\nMembers:\n${members.map(m => `  - ${m.name} (${m.agentType}): ${m.task}`).join('\n')}`
    : '\n\nNo members defined yet. Add them with team-create or activate directly with team-dispatch.';

  return {
    content: `Team '${name}' created.${memberList}\n\nUse team-dispatch to activate members, team-status to monitor progress.`,
    isError: false,
    metadata: { teamName: name, memberCount: members.length },
  };
};
