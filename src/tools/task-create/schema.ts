import type { ToolSchema } from '../types.js';

export const schema: ToolSchema = {
  name: 'TaskCreate',
  description:
    'Create a new task in the task list. Each task has a unique ID and tracks its own status and dependencies. Use this to break complex work into manageable, trackable steps.',
  input_schema: {
    type: 'object',
    properties: {
      subject: {
        type: 'string',
        description: 'A brief, actionable title for the task (imperative form, e.g. "Fix authentication bug")',
      },
      description: {
        type: 'string',
        description: 'What needs to be done — include enough detail to make the task actionable',
      },
      activeForm: {
        type: 'string',
        description: 'Present continuous form shown in the spinner when the task is in_progress (e.g. "Fixing authentication bug")',
      },
      metadata: {
        type: 'object',
        description: 'Arbitrary metadata to attach to the task',
      },
    },
    required: ['subject', 'description'],
  },
  _meta: { riskLevel: 'safe' },
};
