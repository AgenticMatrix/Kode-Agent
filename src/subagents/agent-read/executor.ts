import type { ToolExecutor, ToolResult } from '../../tools/types.js';

export const execute: ToolExecutor = async (input, options): Promise<ToolResult> => {
  const agentSpawn = options.agentSpawn;
  if (!agentSpawn) {
    return {
      content: 'agent-read requires agentSpawn context.',
      isError: true,
    };
  }

  const registry = agentSpawn.subAgentRegistry;
  const listAll = input.list_all as boolean | undefined;
  const agentId = input.agent_id as string | undefined;

  if (listAll) {
    const agents = registry.list();
    if (agents.length === 0) {
      return { content: 'No sub-agents found.', isError: false };
    }

    const lines = agents.map(a => {
      const elapsed = a.finishedAt
        ? `${((a.finishedAt - a.createdAt) / 1000).toFixed(1)}s`
        : `${((Date.now() - a.createdAt) / 1000).toFixed(1)}s elapsed`;
      return [
        `${a.id} (${a.agentType}) — ${a.status}`,
        `  Turns: ${a.turnCount} | Messages: ${a.messageCount} | Tools: ${a.toolCount} | ${elapsed}`,
        a.error ? `  Error: ${a.error}` : '',
        a.result && a.status === 'done' ? `  Result: ${a.result.slice(0, 200)}...` : '',
      ].filter(Boolean).join('\n');
    });

    return { content: `Sub-agents (${agents.length}):\n\n${lines.join('\n\n')}`, isError: false };
  }

  if (agentId) {
    const agent = registry.get(agentId);
    if (!agent) {
      return { content: `Sub-agent not found: ${agentId}`, isError: true };
    }

    const elapsed = agent.finishedAt
      ? `${((agent.finishedAt - agent.createdAt) / 1000).toFixed(1)}s`
      : `${((Date.now() - agent.createdAt) / 1000).toFixed(1)}s elapsed`;

    let content = [
      `Sub-agent: ${agent.id} (${agent.agentType})`,
      `Status: ${agent.status} | ${elapsed}`,
      `Turns: ${agent.turnCount} | Messages: ${agent.messageCount} | Tools: ${agent.toolCount}`,
      `Prompt: ${agent.prompt.slice(0, 200)}`,
      '',
    ];

    if (agent.error) {
      content.push(`Error: ${agent.error}`);
    }

    if (agent.result) {
      content.push('Result:', agent.result);
    } else if (agent.status === 'running') {
      content.push('(Still running — no result yet)');
    }

    return { content: content.join('\n'), isError: false };
  }

  return {
    content: 'Provide agent_id or set list_all to true.',
    isError: true,
  };
};
