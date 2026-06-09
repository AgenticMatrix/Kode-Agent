import type { ToolExecutor } from '../types.js';

interface TodoItem {
  content: string;
  status: string;
  activeForm: string;
}

export const execute: ToolExecutor = async (input, _opts) => {
  const todos = input.todos as TodoItem[] | undefined;

  if (!todos || !Array.isArray(todos)) {
    return { content: 'Error: todos array is required', isError: true };
  }

  const lines = todos.map((t) => {
    const icon = t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '⏳' : '⬜';
    return `${icon} ${t.content}`;
  });

  return { content: lines.join('\n') || '(empty todo list)', isError: false };
};
