import { createTask } from '../../tasks/store.js';
import type { ToolExecutor } from '../types.js';

export const execute: ToolExecutor = async (input, _opts) => {
  const subject = input.subject as string;
  const description = input.description as string;

  if (!subject || !description) {
    return { content: 'Error: subject and description are required', isError: true };
  }

  const task = await createTask({
    subject,
    description,
    activeForm: input.activeForm as string | undefined,
    metadata: (input.metadata as Record<string, unknown>) ?? {},
  });

  return {
    content: `Task #${task.id} created: ${task.subject}`,
    isError: false,
    metadata: { taskId: task.id, subject: task.subject },
  };
};
