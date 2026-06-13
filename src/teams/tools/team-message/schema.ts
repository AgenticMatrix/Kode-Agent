import type { ToolSchema } from '../../../tools/types.js';

export const schema: ToolSchema = {
  name: 'team-message',
  description:
    'Send a message to a teammate or broadcast to the whole team. Messages are delivered to the recipient\'s inbox and can be read later by that agent. Use "*" as the recipient to broadcast to all team members.',
  input_schema: {
    type: 'object',
    properties: {
      team_name: { type: 'string', description: 'Team name' },
      to: { type: 'string', description: 'Recipient name, or "*" to broadcast to all members' },
      text: { type: 'string', description: 'Message content' },
    },
    required: ['team_name', 'to', 'text'],
  },
  _meta: { riskLevel: 'safe' },
};
