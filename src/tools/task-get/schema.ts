import type { ToolSchema } from '../types.js';

export const schema: ToolSchema = {
  name: 'TaskGet',
  description:
    'Retrieve a task by its ID. Returns full task details including subject, description, status, owner, dependencies, and metadata.',
  input_schema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'The ID of the task to retrieve',
      },
    },
    required: ['taskId'],
  },
  _meta: { riskLevel: 'safe' },
};
