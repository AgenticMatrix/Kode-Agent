import type { ToolSchema } from '../../types.js';

export const schema: ToolSchema = {
  name: 'agent-read',
  description: `Read the status and results of sub-agents spawned by agent-spawn.
Use this to check on a running sub-agent's progress or retrieve results from a completed one.`,
  input_schema: {
    type: 'object',
    properties: {
      agent_id: {
        type: 'string',
        description: 'The ID of the sub-agent to read (returned by agent-spawn).',
      },
      list_all: {
        type: 'boolean',
        description: 'If true, list all sub-agents and their statuses.',
      },
    },
  },
  _meta: { riskLevel: 'safe' },
};
