/**
 * task-describe.ts — TaskDescribe tool: retrieve detailed task information
 *
 * Reads the task record from disk (~/.coder/sessions/<sessionId>/tasks/<taskId>.json)
 * and returns full details including name, description, status, dependencies,
 * agent assignment, timestamps, and result summary.
 *
 * Risk: SAFE — read-only, no filesystem mutations.
 * Architecture reference: ARCHITECTURE.md §4.9 (Task System)
 */

import { readFileSync, existsSync } from 'node:fs';
import {
  BaseTool,
  RiskLevel,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
} from '@coder/shared';
import { type TaskRecord, getTaskPath } from './task-create.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskDescribeInput {
  /** ID of the task to describe */
  task_id: string;
}

export interface TaskDescribeOutput {
  taskId: string;
  name: string;
  description: string;
  status: string;
  dependencies: string[];
  agentId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  result?: string;
}

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

const TASK_DESCRIBE_DESCRIPTION = `Get detailed information about a specific task.

Returns the full task record including name, description, current status,
list of dependencies, assigned agent ID (if any), creation and update
timestamps, and any result summary.

Use this to inspect a task's details before updating it or to understand
why a task is blocked (check its dependencies).`;

// ---------------------------------------------------------------------------
// TaskDescribeTool
// ---------------------------------------------------------------------------

export class TaskDescribeTool extends BaseTool<TaskDescribeInput, TaskDescribeOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'TaskDescribe',
      description: TASK_DESCRIBE_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          task_id: {
            type: 'string',
            description: 'The ID of the task to describe',
          },
        },
        required: ['task_id'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.SAFE,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as TaskDescribeInput;
    if (!typed || typeof typed !== 'object') {
      return {
        valid: false,
        errors: [{ path: '', message: 'Input must be an object' }],
      };
    }
    if (typeof typed.task_id !== 'string' || typed.task_id.trim().length === 0) {
      return {
        valid: false,
        errors: [{ path: 'task_id', message: 'task_id must be a non-empty string' }],
      };
    }
    return { valid: true };
  }

  override async execute(
    input: TaskDescribeInput,
    ctx: ToolContext,
  ): Promise<TaskDescribeOutput> {
    const taskPath = getTaskPath(ctx.sessionId, input.task_id);

    if (!existsSync(taskPath)) {
      throw new Error(
        `Task not found: ${input.task_id}. ` +
        `Verify the task ID with TaskList.`,
      );
    }

    let record: TaskRecord;
    try {
      record = JSON.parse(readFileSync(taskPath, 'utf-8')) as TaskRecord;
    } catch {
      throw new Error(
        `Failed to read task record: ${input.task_id}. The task file may be corrupted.`,
      );
    }

    return {
      taskId: record.taskId,
      name: record.name,
      description: record.description,
      status: record.status,
      dependencies: record.dependencies,
      agentId: record.agentId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      completedAt: record.completedAt,
      result: record.result,
    };
  }

  override formatOutput(result: TaskDescribeOutput): string {
    const statusIcon =
      result.status === 'completed'
        ? '✅'
        : result.status === 'failed'
          ? '❌'
          : result.status === 'in_progress'
            ? '🔄'
            : result.status === 'blocked'
              ? '🔒'
              : '⬜';

    const lines: string[] = [
      `${statusIcon} Task: ${result.name}`,
      `ID: ${result.taskId}`,
      `Status: ${result.status}`,
    ];

    if (result.description) {
      lines.push(`Description: ${result.description}`);
    }

    if (result.dependencies.length > 0) {
      const deps = result.dependencies.map((d) => d.slice(0, 8)).join(', ');
      lines.push(`Dependencies (${result.dependencies.length}): ${deps}`);
    } else {
      lines.push(`Dependencies: none`);
    }

    if (result.agentId) {
      lines.push(`Assigned agent: ${result.agentId.slice(0, 8)}`);
    }

    lines.push(`Created: ${result.createdAt}`);
    lines.push(`Updated: ${result.updatedAt}`);

    if (result.completedAt) {
      lines.push(`Completed: ${result.completedAt}`);
    }

    if (result.result) {
      const preview = result.result.length > 300
        ? result.result.slice(0, 300) + '...'
        : result.result;
      lines.push(`Result: ${preview}`);
    }

    return lines.join('\n');
  }
}
