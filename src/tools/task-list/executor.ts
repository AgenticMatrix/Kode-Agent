import { listTasks } from '../../tasks/store.js';
import type { ToolExecutor } from '../types.js';

export const execute: ToolExecutor = async (_input, _opts) => {
  const tasks = await listTasks();

  if (tasks.length === 0) {
    return {
      content: 'No tasks in the task list.',
      isError: false,
      metadata: { tasks: [], count: 0 },
    };
  }

  const summary = tasks.map((t) => {
    const deps = [];
    if (t.blockedBy.length) deps.push(`${t.blockedBy.length} blocking`);
    if (t.blocks.length) deps.push(`${t.blocks.length} blocked`);
    const depInfo = deps.length ? ` [${deps.join(', ')}]` : '';
    return `  ${t.status === 'in_progress' ? '⟳' : t.status === 'completed' ? '✓' : '○'} #${t.id} ${t.subject}${depInfo}`;
  });

  return {
    content: `${tasks.length} task(s):\n${summary.join('\n')}`,
    isError: false,
    metadata: {
      tasks: tasks.map((t) => ({ id: t.id, subject: t.subject, status: t.status, owner: t.owner })),
      count: tasks.length,
    },
  };
};
