import { updateTask, listTasks } from '../../tasks/store.js';
import type { TaskStatus } from '../../tasks/schema.js';
import type { ToolExecutor } from '../types.js';

export const execute: ToolExecutor = async (input, _opts) => {
  const taskId = input.taskId as string;
  if (!taskId) return { content: 'Error: taskId is required', isError: true };

  const statusInput = input.status as TaskStatus | undefined;

  const result = await updateTask(taskId, {
    subject: input.subject as string | undefined,
    description: input.description as string | undefined,
    activeForm: input.activeForm as string | undefined,
    status: statusInput,
    owner: input.owner as string | undefined,
    addBlocks: input.addBlocks as string[] | undefined,
    addBlockedBy: input.addBlockedBy as string[] | undefined,
    metadata: input.metadata as Record<string, unknown> | undefined,
  });

  if ('error' in result) {
    return { content: `Error: ${result.error}`, isError: true };
  }

  const { task, updatedFields } = result;
  const wasDeleted = updatedFields.includes('status') && (input.status as string) === 'deleted';
  const statusNote = updatedFields.includes('status')
    ? ` (${wasDeleted ? 'deleted' : task.status})`
    : '';

  let content = `Task #${task.id} updated: ${updatedFields.join(', ')}${statusNote}`;

  // Verification nudge: when the main-thread agent closes out the last task
  // in a list of 3+ tasks and none was a verification step, append a reminder.
  if (statusInput === 'completed') {
    const allTasks = await listTasks();
    const allDone = allTasks.every(t => t.status === 'completed');
    if (
      allDone &&
      allTasks.length >= 3 &&
      !allTasks.some(t => /verif/i.test(t.subject))
    ) {
      content +=
        '\n\nNOTE: You just closed out 3+ tasks and none of them was a verification step. ' +
        'Before writing your final summary, spawn a verification agent to review the work. ' +
        'Do not self-declare success — only a verifier can issue the final verdict.';
    }
  }

  return {
    content,
    isError: false,
    metadata: { taskId: task.id, updatedFields, status: task.status },
  };
};
