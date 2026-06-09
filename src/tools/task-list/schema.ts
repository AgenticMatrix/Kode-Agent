import type { ToolSchema } from '../types.js';

export const schema: ToolSchema = {
  name: 'TaskList',
  description:
    'List all tasks in the task list. Returns task id, subject, status, owner, and dependency counts for each task.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
  _meta: { riskLevel: 'safe' },
};
