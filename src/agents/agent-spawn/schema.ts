import type { ToolSchema } from '../../tools/types.js';

export const schema: ToolSchema = {
  name: 'agent-spawn',
  description: `Spawn a sub-agent to handle a specific subtask. The sub-agent can
use tools to accomplish its task and returns a text summary of its findings.
Multiple sub-agents can run concurrently for parallel work.
Sub-agents cannot spawn further sub-agents (depth limit = 1).

Use this for:
- Parallel codebase exploration
- Delegating well-scoped implementation tasks
- Independent research that can run concurrently

The sub-agent will work autonomously and return a text summary. Use agent-read
to check on a running sub-agent's progress and agent-stop to cancel it.
If agent_type is omitted, the sub-agent inherits the parent's context (fork mode).`,
  input_schema: {
    type: 'object',
    properties: {
      agent_type: {
        type: 'string',
        description: 'The type of sub-agent. "explore" is read-only search. "general-purpose" has full tool access. Omit to fork the parent agent with full context.',
      },
      prompt: {
        type: 'string',
        description: 'The task description for the sub-agent. Be specific about what to accomplish.',
      },
      model: {
        type: 'string',
        description: 'Optional model override for the sub-agent.',
      },
      background: {
        type: 'boolean',
        description: 'When true, the sub-agent runs in the background without blocking the main loop. Use agent-read to check progress and results.',
      },
    },
    required: ['prompt'],
  },
  _meta: { riskLevel: 'mutation', isConcurrencySafe: true },
};
