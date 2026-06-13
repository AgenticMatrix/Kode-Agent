import type { ToolExecutor, ToolResult } from '../../tools/types.js';
import { unassignTeammateTasks } from '../../tasks/store.js';

export const execute: ToolExecutor = async (input, options): Promise<ToolResult> => {
  const agentSpawn = options.agentSpawn;
  if (!agentSpawn) {
    return {
      content: 'agent-stop requires agentSpawn context.',
      isError: true,
    };
  }

  const agentId = input.agent_id as string;
  const registry = agentSpawn.subAgentRegistry;
  const agent = registry.get(agentId);

  if (!agent) {
    return { content: `Sub-agent not found: ${agentId}`, isError: true };
  }

  if (agent.status !== 'running') {
    return { content: `Sub-agent ${agentId} is already ${agent.status}.`, isError: false };
  }

  const stopped = registry.abort(agentId);
  if (!stopped) {
    return { content: `Failed to stop sub-agent ${agentId}.`, isError: true };
  }

  // Reclaim any open tasks owned by this agent
  const ownerName = agent.name || agentId;
  const { unassignedTasks } = await unassignTeammateTasks(ownerName);

  let message = `Sub-agent ${agentId} stopped. Turns: ${agent.turnCount}, Tools: ${agent.toolCount}.`;
  if (unassignedTasks.length > 0) {
    const taskList = unassignedTasks.map(t => `#${t.id} "${t.subject}"`).join(', ');
    message += ` ${unassignedTasks.length} task(s) unassigned: ${taskList}.`;
  }

  return {
    content: message,
    isError: false,
    metadata: {
      agentId,
      turnCount: agent.turnCount,
      toolCount: agent.toolCount,
      unassignedTasks: unassignedTasks.length,
    },
  };
};
