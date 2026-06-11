import type { ToolExecutor, ToolResult } from '../../tools/types.js';

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
  if (stopped) {
    return {
      content: `Sub-agent ${agentId} stopped. Turns: ${agent.turnCount}, Tools: ${agent.toolCount}.`,
      isError: false,
      metadata: { agentId, turnCount: agent.turnCount, toolCount: agent.toolCount },
    };
  }

  return { content: `Failed to stop sub-agent ${agentId}.`, isError: true };
};
