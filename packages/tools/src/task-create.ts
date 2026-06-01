/**
 * TaskCreateTool — Create trackable background tasks
 *
 * Creates a task description JSON file with a unique task ID.
 * Tasks can be tracked via TaskUpdate and queried via TaskList.
 *
 * Risk: SAFE — only writes to session directory.
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  BaseTool,
  RiskLevel,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
} from '@kode/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export interface TaskCreateInput {
  name: string;
  description: string;
  dependencies?: string[];
  agentId?: string;
}

export interface TaskCreateOutput {
  taskId: string;
  name: string;
  status: TaskStatus;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

interface TaskRecord {
  taskId: string;
  name: string;
  description: string;
  status: TaskStatus;
  dependencies: string[];
  agentId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  result?: string;
  error?: string;
}

function getTasksDir(sessionId: string): string {
  const dir = join(homedir(), '.kode', 'sessions', sessionId, 'tasks');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getTaskPath(sessionId: string, taskId: string): string {
  return join(getTasksDir(sessionId), `${taskId}.json`);
}

// ---------------------------------------------------------------------------
// TaskCreateTool
// ---------------------------------------------------------------------------

const TASK_CREATE_DESCRIPTION = `Create a trackable background task for long-running or multi-step work.

Tasks can be linked together via 'dependencies' to form a task graph.
Use 'agentId' to assign tasks to specific sub-agents.

The task lifecycle:
  pending → in_progress → completed / failed / cancelled`;

export class TaskCreateTool extends BaseTool<TaskCreateInput, TaskCreateOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'TaskCreate',
      description: TASK_CREATE_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Task name (short, descriptive)' },
          description: { type: 'string', description: 'Detailed task description' },
          dependencies: { type: 'array', items: { type: 'string' }, description: 'IDs of tasks this depends on' },
          agentId: { type: 'string', description: 'Assign to a specific agent' },
        },
        required: ['name', 'description'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.SAFE,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as TaskCreateInput;
    if (!typed || typeof typed !== 'object') {
      return { valid: false, errors: [{ path: '', message: 'Input must be an object' }] };
    }
    if (typeof typed.name !== 'string' || typed.name.trim().length === 0) {
      return { valid: false, errors: [{ path: 'name', message: 'name must be a non-empty string' }] };
    }
    if (typeof typed.description !== 'string' || typed.description.trim().length === 0) {
      return { valid: false, errors: [{ path: 'description', message: 'description must be a non-empty string' }] };
    }
    return { valid: true };
  }

  override async execute(input: TaskCreateInput, ctx: ToolContext): Promise<TaskCreateOutput> {
    const taskId = randomUUID();
    const now = new Date().toISOString();

    const record: TaskRecord = {
      taskId,
      name: input.name,
      description: input.description,
      status: 'pending',
      dependencies: input.dependencies ?? [],
      agentId: input.agentId,
      createdAt: now,
      updatedAt: now,
    };

    const taskPath = getTaskPath(ctx.sessionId, taskId);
    writeFileSync(taskPath, JSON.stringify(record, null, 2), 'utf-8');

    return {
      taskId,
      name: input.name,
      status: 'pending',
      createdAt: now,
    };
  }

  override formatOutput(result: TaskCreateOutput): string {
    return `Task created: [${result.taskId}] ${result.name} (pending)`;
  }
}

// Export record type for task-update.ts
export type { TaskRecord };
export { getTasksDir, getTaskPath };
