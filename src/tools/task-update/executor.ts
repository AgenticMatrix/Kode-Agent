import { updateTask, type TaskStatus } from '../../tasks/store.js';
import type { ToolExecutor } from '../types.js';

export const execute: ToolExecutor = async (input, _opts) => {
  const taskId = input.taskId as string;
  if (!taskId) return { content: 'Error: taskId is required', isError: true };

  const result = updateTask(taskId, {
    subject: input.subject as string | undefined,
    description: input.description as string | undefined,
    activeForm: input.activeForm as string | undefined,
    status: input.status as TaskStatus | undefined,
    owner: input.owner as string | undefined,
    addBlocks: input.addBlocks as string[] | undefined,
    addBlockedBy: input.addBlockedBy as string[] | undefined,
    metadata: input.metadata as Record<string, unknown> | undefined,
  });

  if ('error' in result) {
    return { content: `Error: ${result.error}`, isError: true };
  }

  const { task, updatedFields } = result;
  const statusNote = updatedFields.includes('status')
    ? ` (${task.status === 'deleted' ? 'deleted' : task.status})`
    : '';

  return {
    content: `Task #${task.id} updated: ${updatedFields.join(', ')}${statusNote}`,
    isError: false,
    metadata: { taskId: task.id, updatedFields, status: task.status },
  };
};
