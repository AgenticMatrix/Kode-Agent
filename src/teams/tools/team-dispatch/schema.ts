import type { ToolSchema } from '../../../tools/types.js';

export const schema: ToolSchema = {
  name: 'team-dispatch',
  description:
    'Activate team members by spawning them as background sub-agents. Members with "pending" status are spawned using the agent-spawn tool. After dispatch, use team-status to monitor progress. Each dispatched member gets a real agentId from the SubAgentRegistry, enabling agent-read and agent-stop.',
  input_schema: {
    type: 'object',
    properties: {
      team_name: {
        type: 'string',
        description: 'Name of the team whose members to activate',
      },
      members: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific member names to dispatch. Omit to dispatch all pending members.',
      },
      background: {
        type: 'boolean',
        description: 'When true, run all members in background (default: true)',
      },
    },
    required: ['team_name'],
  },
  _meta: { riskLevel: 'mutation', isConcurrencySafe: true },
};
