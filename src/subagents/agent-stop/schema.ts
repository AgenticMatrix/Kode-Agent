import type { ToolSchema } from '../../tools/types.js';

export const schema: ToolSchema = {
  name: 'agent-stop',
  description: `Stop a running sub-agent. The sub-agent will be aborted and its
partial results will be returned.`,
  input_schema: {
    type: 'object',
    properties: {
      agent_id: {
        type: 'string',
        description: 'The ID of the sub-agent to stop.',
      },
    },
    required: ['agent_id'],
  },
  _meta: { riskLevel: 'safe' },
};
