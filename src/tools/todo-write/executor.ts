import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { getTaskListId } from '../../tasks/store.js';
import type { ToolExecutor } from '../types.js';

interface TodoItem {
  content: string;
  status: string;
  activeForm: string;
}

interface TodoStore {
  todos: TodoItem[];
  updatedAt: number;
}

const TODOS_BASE_DIR = join(homedir(), '.coder', 'todos');

function getTodoPath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '-');
  return join(TODOS_BASE_DIR, `${safe}.json`);
}

async function loadTodos(sessionId: string): Promise<TodoItem[]> {
  try {
    const content = await readFile(getTodoPath(sessionId), 'utf-8');
    const data = JSON.parse(content) as TodoStore;
    return Array.isArray(data.todos) ? data.todos : [];
  } catch {
    return [];
  }
}

async function saveTodos(sessionId: string, todos: TodoItem[]): Promise<void> {
  const dir = TODOS_BASE_DIR;
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // Directory already exists
  }
  const store: TodoStore = { todos, updatedAt: Date.now() };
  await writeFile(getTodoPath(sessionId), JSON.stringify(store, null, 2));
}

export const execute: ToolExecutor = async (input, _opts) => {
  const todos = input.todos as TodoItem[] | undefined;

  if (!todos || !Array.isArray(todos)) {
    return { content: 'Error: todos array is required', isError: true };
  }

  const sessionId = _opts.sessionId || getTaskListId();

  // Full-replace: clear completed-only lists, otherwise save as-is
  const allDone = todos.every((t) => t.status === 'completed');
  const newTodos = allDone ? [] : todos;
  await saveTodos(sessionId, newTodos);

  // Build display lines
  const lines = newTodos.length === 0
    ? ['(all tasks completed)']
    : newTodos.map((t) => {
        const icon = t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '⏳' : '⬜';
        return `${icon} ${t.content}`;
      });

  return {
    content: lines.join('\n') || '(empty todo list)',
    isError: false,
    metadata: { count: newTodos.length },
  };
};
