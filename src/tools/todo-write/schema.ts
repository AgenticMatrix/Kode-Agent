import type { ToolSchema } from '../types.js';

export const schema: ToolSchema = {
  name: 'todo-write',
  description: 'Create and manage a structured task list.',
  input_schema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', minLength: 1 },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            activeForm: { type: 'string', minLength: 1 },
          },
          required: ['content', 'status', 'activeForm'],
        },
      },
    },
    required: ['todos'],
  },
  _meta: { riskLevel: 'safe' },
};
