import type { ToolPlugin } from '../types.js';
import { schema } from './schema.js';
import { execute } from './executor.js';
import { TodoWriteRenderer } from './renderer.js';
import { isTodoV2Enabled } from '../../tasks/store.js';

const todoWritePlugin: ToolPlugin = {
  name: 'todo-write',
  schema,
  executor: execute,
  useRenderer: TodoWriteRenderer,
  isEnabled: () => !isTodoV2Enabled(),
  paramSummary: (input) => {
    const todos = input.todos as Array<unknown> | undefined;
    if (!todos || !Array.isArray(todos)) return undefined;
    const counts = { pending: 0, in_progress: 0, completed: 0 };
    for (const t of todos) {
      const s = (t as Record<string, string>)?.status;
      if (s && s in counts) (counts as Record<string, number>)[s]++;
    }
    const total = todos.length;
    return `${total} item${total !== 1 ? 's' : ''}${counts.in_progress ? ` (${counts.in_progress} active)` : ''}`;
  },
};

export default todoWritePlugin;
