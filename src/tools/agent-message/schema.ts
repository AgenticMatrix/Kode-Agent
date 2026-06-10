import type { ToolSchema } from '../types.js';

export const schema: ToolSchema = {
  name: 'agent-message',
  description: `Send a follow-up message to a completed sub-agent to continue the conversation.
Not yet fully implemented.`,
  input_schema: {
    type: 'object',
    properties: {
      agent_id: {
        type: 'string',
        description: 'The ID of the sub-agent to message.',
      },
      message: {
        type: 'string',
        description: 'The message to send.',
      },
    },
    required: ['agent_id', 'message'],
  },
  _meta: { riskLevel: 'safe' },
};
