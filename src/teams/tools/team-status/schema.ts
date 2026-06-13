import type { ToolSchema } from '../../../tools/types.js';

export const schema: ToolSchema = {
  name: 'team-status',
  description:
    'Query the status of a team: member list, their work progress, and unread message counts. Use this to monitor team health. Omit team_name to list all teams.',
  input_schema: {
    type: 'object',
    properties: {
      team_name: {
        type: 'string',
        description: 'Name of the team to query. Omit to list all teams.',
      },
    },
    required: [],
  },
  _meta: { riskLevel: 'safe' },
};
