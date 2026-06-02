/**
 * TodoWriteTool — Structured task planning
 *
 * Creates and manages a structured task list for complex multi-step tasks.
 * Persists task state to the session directory as JSON.
 *
 * Risk: SAFE — no filesystem mutations outside session directory.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  BaseTool,
  RiskLevel,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
} from '@coder/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  content: string;
  status: TodoStatus;
  activeForm: string;
}

export interface TodoWriteInput {
  todos: TodoItem[];
}

export interface TodoWriteOutput {
  todos: TodoItem[];
  totalCount: number;
  completedCount: number;
  pendingCount: number;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function getTodoPath(sessionId: string): string {
  const dir = join(homedir(), '.coder', 'sessions', sessionId);
  return join(dir, 'todos.json');
}

function ensureDir(filePath: string): void {
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// TodoWriteTool
// ---------------------------------------------------------------------------

const TODO_DESCRIPTION = `Create and manage a structured task list for your current coding session.

Use this tool for complex multi-step tasks (3+ distinct steps).
DO NOT use it for simple single-step operations.

Rules:
- Exactly ONE task in_progress at a time
- Mark tasks complete IMMEDIATELY after finishing
- Use 'activeForm' to describe the current action (present continuous)

Example:
{
  "todos": [
    { "content": "Implement login form", "status": "in_progress", "activeForm": "Implementing login form" },
    { "content": "Add API endpoint", "status": "pending", "activeForm": "Adding API endpoint" }
  ]
}`;

export class TodoWriteTool extends BaseTool<TodoWriteInput, TodoWriteOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'TodoWrite',
      description: TODO_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: 'Task description (imperative form)' },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed'],
                  description: 'Task status',
                },
                activeForm: { type: 'string', description: 'Present continuous form for display during execution' },
              },
              required: ['content', 'status', 'activeForm'],
              additionalProperties: false,
            },
            description: 'The updated todo list',
          },
        },
        required: ['todos'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.SAFE,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as TodoWriteInput;
    if (!typed || typeof typed !== 'object') {
      return { valid: false, errors: [{ path: '', message: 'Input must be an object' }] };
    }
    if (!Array.isArray(typed.todos)) {
      return { valid: false, errors: [{ path: 'todos', message: 'todos must be an array' }] };
    }

    // Check for valid statuses
    const validStatuses: TodoStatus[] = ['pending', 'in_progress', 'completed'];
    for (let i = 0; i < typed.todos.length; i++) {
      const item = typed.todos[i]!;
      if (typeof item.content !== 'string' || item.content.trim().length === 0) {
        return { valid: false, errors: [{ path: `todos[${i}].content`, message: 'content must be a non-empty string' }] };
      }
      if (!validStatuses.includes(item.status)) {
        return { valid: false, errors: [{ path: `todos[${i}].status`, message: `status must be one of: ${validStatuses.join(', ')}` }] };
      }
      if (typeof item.activeForm !== 'string' || item.activeForm.trim().length === 0) {
        return { valid: false, errors: [{ path: `todos[${i}].activeForm`, message: 'activeForm must be a non-empty string' }] };
      }
    }

    // Check for multiple in_progress tasks
    const inProgress = typed.todos.filter((t) => t.status === 'in_progress');
    if (inProgress.length > 1) {
      return { valid: false, errors: [{ path: 'todos', message: 'Only one task can be in_progress at a time' }] };
    }

    return { valid: true };
  }

  override async execute(input: TodoWriteInput, ctx: ToolContext): Promise<TodoWriteOutput> {
    const todoPath = getTodoPath(ctx.sessionId);
    ensureDir(todoPath);

    // Persist to session directory
    writeFileSync(todoPath, JSON.stringify(input.todos, null, 2), 'utf-8');

    const completed = input.todos.filter((t) => t.status === 'completed').length;
    const pending = input.todos.filter((t) => t.status !== 'completed').length;

    return {
      todos: input.todos,
      totalCount: input.todos.length,
      completedCount: completed,
      pendingCount: pending,
    };
  }

  override formatOutput(result: TodoWriteOutput): string {
    const lines: string[] = [];
    for (const todo of result.todos) {
      const icon = todo.status === 'completed' ? '✅' : todo.status === 'in_progress' ? '🔄' : '⬜';
      lines.push(`${icon} ${todo.status === 'in_progress' ? todo.activeForm : todo.content}`);
    }
    return `Tasks: ${result.completedCount}/${result.totalCount} completed\n${lines.join('\n')}`;
  }
}
