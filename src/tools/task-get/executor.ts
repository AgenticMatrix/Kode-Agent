import { getTask } from '../../tasks/store.js';
import type { ToolExecutor } from '../types.js';

export const execute: ToolExecutor = async (input, _opts) => {
  const taskId = input.taskId as string;
  if (!taskId) return { content: 'Error: taskId is required', isError: true };

  const task = getTask(taskId);
  if (!task) return { content: `Error: Task #${taskId} not found`, isError: true };

  const details = [
    `Task #${task.id}: ${task.subject}`,
    `Status: ${task.status}`,
    `Description: ${task.description}`,
  ];
  if (task.activeForm) details.push(`Active form: ${task.activeForm}`);
  if (task.owner) details.push(`Owner: ${task.owner}`);
  if (task.blocks.length) details.push(`Blocks: ${task.blocks.join(', ')}`);
  if (task.blockedBy.length) details.push(`Blocked by: ${task.blockedBy.join(', ')}`);
  if (Object.keys(task.metadata).length) {
    details.push(`Metadata: ${JSON.stringify(task.metadata)}`);
  }

  return {
    content: details.join('\n'),
    isError: false,
    metadata: {
      taskId: task.id,
      subject: task.subject,
      status: task.status,
      owner: task.owner,
    },
  };
};
