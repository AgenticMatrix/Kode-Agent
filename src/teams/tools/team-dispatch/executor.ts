import type { ToolExecutor } from '../../../tools/types.js';
import { loadTeamConfig, updateTeamMember } from '../../team-store.js';
import { executeTool } from '../../../tools/registry.js';
import type { TeamConfig, TeamMember } from '../../types.js';

function buildTeamMemberPrompt(
  teamName: string,
  member: TeamMember,
  config: TeamConfig,
): string {
  const teammateNames = config.members
    .filter(m => m.name !== member.name)
    .map(m => `- ${m.name} (${m.agentType}): ${m.task ?? 'no task assigned'}`)
    .join('\n');

  return [
    `[Team: ${teamName} — You are team member "${member.name}"]`,
    '',
    '## Your Task',
    member.task,
    '',
    '## Team Context',
    `Team: ${config.name}`,
    `Description: ${config.description}`,
    '',
    '## Teammates',
    teammateNames || '(you are the only member)',
    '',
    '## Communication',
    'Use the team-message tool to send messages to your teammates.',
    `Example: team-message team_name="${teamName}" to="<teammate-name>" text="<your message>"`,
    'Use to="*" to broadcast to all teammates.',
    'The coordinator will also send you messages — check for them in your context.',
  ].join('\n');
}

export const execute: ToolExecutor = async (input, options) => {
  const teamName = input.team_name as string;
  const memberFilter = input.members as string[] | undefined;
  const background = input.background !== false;

  const config = await loadTeamConfig(teamName);
  if (!config) {
    return {
      content: `Team '${teamName}' not found. Use team-create first.`,
      isError: true,
    };
  }

  const toDispatch = config.members.filter((m) => {
    if (m.status !== 'pending') return false;
    if (memberFilter && memberFilter.length > 0 && !memberFilter.includes(m.name)) return false;
    return true;
  });

  if (toDispatch.length === 0) {
    const pending = config.members.filter(m => m.status === 'pending').length;
    if (pending > 0 && memberFilter && memberFilter.length > 0) {
      return {
        content: `None of the specified members match pending members in '${teamName}'. Available: ${config.members.filter(m => m.status === 'pending').map(m => m.name).join(', ')}`,
        isError: true,
      };
    }
    return {
      content: `No pending members to dispatch in '${teamName}'. All members are already activated.`,
      isError: false,
    };
  }

  const results: Array<{ name: string; agentId: string; agentType: string; task: string }> = [];

  // Spawn each member via the existing agent-spawn tool as background agents
  for (const member of toDispatch) {
    try {
      const result = await executeTool(
        'agent-spawn',
        {
          agent_type: member.agentType,
          prompt: buildTeamMemberPrompt(teamName, member, config),
          model: member.model,
          background,
          team_name: teamName,
          member_name: member.name,
        },
        {
          cwd: options.cwd,
          allowMutation: options.allowMutation,
          agentSpawn: options.agentSpawn,
          sessionId: options.sessionId,
        },
      );

      const agentId = (result.metadata?.agentId as string) ?? '';
      if (agentId) {
        // Update team member with real agentId from SubAgentRegistry
        await updateTeamMember(teamName, member.agentId, {
          agentId,
          status: 'running',
        });
        results.push({
          name: member.name,
          agentId,
          agentType: member.agentType,
          task: member.task ?? '',
        });
      }
    } catch (err) {
      await updateTeamMember(teamName, member.agentId, {
        status: 'error',
      });
      results.push({
        name: member.name,
        agentId: 'error',
        agentType: member.agentType,
        task: `Failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const modeText = background ? 'background' : 'foreground';
  const lines = [
    `Dispatched ${results.length} member(s) from '${teamName}' in ${modeText} mode:`,
    ...results.map(r => `  - **${r.name}** (${r.agentType}) → \`${r.agentId}\`: ${r.task}`),
    '',
    'Use team-status to monitor progress, agent-read to check individual results.',
  ];

  return {
    content: lines.join('\n'),
    isError: false,
    metadata: { teamName, dispatchedCount: results.length, agentIds: results.map(r => r.agentId) },
  };
};
