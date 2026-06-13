import type { ToolSchema } from '../types.js';
import { TASK_STATUSES } from '../../tasks/schema.js';

export const schema: ToolSchema = {
  name: 'TaskUpdate',
  description:
    'Update a task\'s properties — status, subject, description, dependencies, or owner. Set status to "deleted" to remove a task. Use this to track progress through the task list.',
  input_schema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'The ID of the task to update',
      },
      subject: {
        type: 'string',
        description: 'New subject for the task',
      },
      description: {
        type: 'string',
        description: 'New description for the task',
      },
      activeForm: {
        type: 'string',
        description: 'Present continuous form shown in spinner when in_progress',
      },
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed', 'deleted'],
        description: 'New status for the task',
      },
      owner: {
        type: 'string',
        description: 'New owner for the task',
      },
      addBlocks: {
        type: 'array',
        items: { type: 'string' },
        description: 'Task IDs that this task blocks (cannot start until this task completes)',
      },
      addBlockedBy: {
        type: 'array',
        items: { type: 'string' },
        description: 'Task IDs that block this task (must complete before this one can start)',
      },
      metadata: {
        type: 'object',
        description: 'Metadata keys to merge into the task',
      },
    },
    required: ['taskId'],
  },
  _meta: { riskLevel: 'safe' },
};
