/**
 * TaskUpdateTool — Update task status
 *
 * Reads and updates the JSON task record created by TaskCreateTool.
 * Implements the task state machine:
 *   pending → in_progress → completed / failed / cancelled
 *
 * Risk: SAFE — only modifies session directory files.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import {
  BaseTool,
  RiskLevel,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
} from '@kode/shared';
import { type TaskRecord, getTaskPath } from './task-create.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export interface TaskUpdateInput {
  taskId: string;
  status: TaskStatus;
  result?: string;
  error?: string;
}

export interface TaskUpdateOutput {
  taskId: string;
  name: string;
  oldStatus: TaskStatus;
  newStatus: TaskStatus;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// State machine valid transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: ['in_progress', 'cancelled'],
  cancelled: ['pending'],
};

// ---------------------------------------------------------------------------
// TaskUpdateTool
// ---------------------------------------------------------------------------

const TASK_UPDATE_DESCRIPTION = `Update the status of a trackable task.

Valid status transitions:
  pending    → in_progress, cancelled
  in_progress → completed, failed, cancelled
  failed     → in_progress, cancelled
  cancelled  → pending

Provide 'result' when completed, or 'error' when failed.`;

export class TaskUpdateTool extends BaseTool<TaskUpdateInput, TaskUpdateOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'TaskUpdate',
      description: TASK_UPDATE_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'The task ID from TaskCreate' },
          status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'completed', 'failed', 'cancelled'],
            description: 'New status for the task',
          },
          result: { type: 'string', description: 'Result/summary (when status is completed)' },
          error: { type: 'string', description: 'Error details (when status is failed)' },
        },
        required: ['taskId', 'status'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.SAFE,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as TaskUpdateInput;
    if (!typed || typeof typed !== 'object') {
      return { valid: false, errors: [{ path: '', message: 'Input must be an object' }] };
    }
    if (typeof typed.taskId !== 'string' || typed.taskId.trim().length === 0) {
      return { valid: false, errors: [{ path: 'taskId', message: 'taskId must be a non-empty string' }] };
    }
    const validStatuses: TaskStatus[] = ['pending', 'in_progress', 'completed', 'failed', 'cancelled'];
    if (!validStatuses.includes(typed.status)) {
      return { valid: false, errors: [{ path: 'status', message: `status must be one of: ${validStatuses.join(', ')}` }] };
    }
    return { valid: true };
  }

  override async execute(input: TaskUpdateInput, ctx: ToolContext): Promise<TaskUpdateOutput> {
    const taskPath = getTaskPath(ctx.sessionId, input.taskId);

    if (!existsSync(taskPath)) {
      throw new Error(`Task not found: ${input.taskId}. Use TaskCreate first.`);
    }

    const record: TaskRecord = JSON.parse(readFileSync(taskPath, 'utf-8'));
    const oldStatus = record.status;

    // Validate transition
    const allowedTransitions = VALID_TRANSITIONS[oldStatus];
    if (!allowedTransitions || !allowedTransitions.includes(input.status)) {
      throw new Error(
        `Invalid status transition: ${oldStatus} → ${input.status}. ` +
        `Allowed transitions: ${allowedTransitions?.join(', ') ?? 'none'}`,
      );
    }

    const now = new Date().toISOString();
    record.status = input.status;
    record.updatedAt = now;

    if (input.status === 'completed' || input.status === 'failed') {
      record.completedAt = now;
      if (input.status === 'completed' && input.result) {
        record.result = input.result;
      }
      if (input.status === 'failed' && input.error) {
        record.error = input.error;
      }
    }

    writeFileSync(taskPath, JSON.stringify(record, null, 2), 'utf-8');

    return {
      taskId: input.taskId,
      name: record.name,
      oldStatus,
      newStatus: input.status,
      updatedAt: now,
    };
  }

  override formatOutput(result: TaskUpdateOutput): string {
    const arrow = '→';
    return `Task [${result.taskId}] ${result.name}: ${result.oldStatus} ${arrow} ${result.newStatus}`;
  }
}
