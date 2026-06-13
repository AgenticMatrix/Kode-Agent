import type { ToolSchema } from '../../../tools/types.js';

export const schema: ToolSchema = {
  name: 'team-create',
  description:
    'Create a new team for coordinated multi-agent work. A team defines a roster of members (each with a name, agent type, and task) that can be activated with team-dispatch. The team persists in ~/.coder/teams/ and supports inter-agent messaging via team-message.',
  input_schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Team name (used as a directory name, sanitized automatically)',
      },
      description: {
        type: 'string',
        description: 'Purpose of this team — what problem it should solve',
      },
      members: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Display name for this team member (e.g. "researcher")' },
            agent_type: { type: 'string', description: 'Agent type: explore, plan, or general-purpose' },
            task: { type: 'string', description: 'Brief description of what this member should do' },
            model: { type: 'string', description: 'Optional model override for this member' },
          },
          required: ['name', 'agent_type', 'task'],
        },
        description: 'Initial team members to define. Activate them later with team-dispatch.',
      },
    },
    required: ['name', 'description'],
  },
  _meta: { riskLevel: 'safe' },
};
