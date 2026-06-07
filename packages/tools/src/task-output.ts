/**
 * TaskOutputTool — Get output from a running or completed background task
 *
 * Reads the output file for a specific task. Supports blocking mode
 * that polls until the task reaches a terminal status or times out.
 *
 * Risk: SAFE — read-only, no filesystem mutations.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  BaseTool,
  RiskLevel,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
} from '@coder/shared';
import { type TaskRecord, getTaskPath, getTasksDir } from './task-create.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export interface TaskOutputInput {
  taskId: string;
  block?: boolean;
  timeout?: number;
}

export interface TaskOutputOutput {
  taskId: string;
  status: TaskStatus;
  stdout: string;
  stderr: string;
  completed: boolean;
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function getOutputPath(sessionId: string, taskId: string): string {
  return join(getTasksDir(sessionId), `${taskId}.output`);
}

// ---------------------------------------------------------------------------
// TaskOutputTool
// ---------------------------------------------------------------------------

const TASK_OUTPUT_DESCRIPTION = `Retrieve output from a running or completed background task.

Reads stdout/stderr captured from the task. Set 'block' to true to wait
for the task to reach a terminal state (completed/failed/cancelled) before
returning. 'timeout' sets the maximum wait time in milliseconds (default: 30000).

Use this to check results from long-running background sub-agents.`;

export class TaskOutputTool extends BaseTool<TaskOutputInput, TaskOutputOutput> {
  private static readonly DEFAULT_TIMEOUT_MS = 30_000;
  private static readonly POLL_INTERVAL_MS = 500;

  override get definition(): ToolDefinition {
    return {
      name: 'TaskOutput',
      description: TASK_OUTPUT_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'The task ID to retrieve output for',
          },
          block: {
            type: 'boolean',
            description: 'Wait for task completion before returning (default: false)',
          },
          timeout: {
            type: 'number',
            description: `Max wait time in ms when block=true (default: ${TaskOutputTool.DEFAULT_TIMEOUT_MS})`,
          },
        },
        required: ['taskId'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.SAFE,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as TaskOutputInput;
    if (!typed || typeof typed !== 'object') {
      return {
        valid: false,
        errors: [{ path: '', message: 'Input must be an object' }],
      };
    }
    if (typeof typed.taskId !== 'string' || typed.taskId.trim().length === 0) {
      return {
        valid: false,
        errors: [{ path: 'taskId', message: 'taskId must be a non-empty string' }],
      };
    }
    if (typed.block !== undefined && typeof typed.block !== 'boolean') {
      return {
        valid: false,
        errors: [{ path: 'block', message: 'block must be a boolean' }],
      };
    }
    if (typed.timeout !== undefined && typeof typed.timeout !== 'number') {
      return {
        valid: false,
        errors: [{ path: 'timeout', message: 'timeout must be a number' }],
      };
    }
    return { valid: true };
  }

  override async execute(
    input: TaskOutputInput,
    ctx: ToolContext,
  ): Promise<TaskOutputOutput> {
    const taskPath = getTaskPath(ctx.sessionId, input.taskId);
    const outputPath = getOutputPath(ctx.sessionId, input.taskId);

    // Verify task exists
    if (!existsSync(taskPath)) {
      throw new Error(
        `Task not found: ${input.taskId}. Verify the task ID with TaskList.`,
      );
    }

    const block = input.block === true;
    const timeout = input.timeout ?? TaskOutputTool.DEFAULT_TIMEOUT_MS;

    if (block) {
      // Poll until terminal status or timeout
      return this.pollForCompletion(taskPath, outputPath, input.taskId, timeout);
    }

    // Non-blocking: return current state immediately
    return this.readCurrentState(taskPath, outputPath, input.taskId);
  }

  // ── Polling ───────────────────────────────────────────────────

  private async pollForCompletion(
    taskPath: string,
    outputPath: string,
    taskId: string,
    timeout: number,
  ): Promise<TaskOutputOutput> {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const state = this.readCurrentState(taskPath, outputPath, taskId);

      if (state.completed) {
        return state;
      }

      // Sleep for poll interval
      await new Promise((resolve) =>
        setTimeout(resolve, TaskOutputTool.POLL_INTERVAL_MS),
      );
    }

    // Timed out — return current state
    const state = this.readCurrentState(taskPath, outputPath, taskId);

    // Read the task record to include its current status
    try {
      const record: TaskRecord = JSON.parse(readFileSync(taskPath, 'utf-8'));
      return { ...state, status: record.status };
    } catch {
      return state;
    }
  }

  // ── State Reader ──────────────────────────────────────────────

  private readCurrentState(
    taskPath: string,
    outputPath: string,
    taskId: string,
  ): TaskOutputOutput {
    let status: TaskStatus = 'pending';

    try {
      const record: TaskRecord = JSON.parse(readFileSync(taskPath, 'utf-8'));
      status = record.status;
    } catch {
      // Task file corrupted/missing — assume pending
    }

    const isTerminal =
      status === 'completed' || status === 'failed' || status === 'cancelled';

    let stdout = '';
    let stderr = '';

    if (existsSync(outputPath)) {
      try {
        const raw = readFileSync(outputPath, 'utf-8');
        // Output format: lines prefixed with [stdout] or [stderr]
        const outLines: string[] = [];
        const errLines: string[] = [];

        for (const line of raw.split('\n')) {
          if (line.startsWith('[stderr]')) {
            errLines.push(line.slice(8));
          } else if (line.startsWith('[stdout]')) {
            outLines.push(line.slice(8));
          } else {
            // Untagged lines go to stdout
            outLines.push(line);
          }
        }

        stdout = outLines.join('\n');
        stderr = errLines.join('\n');
      } catch {
        stdout = '';
        stderr = '';
      }
    }

    return {
      taskId,
      status,
      stdout,
      stderr,
      completed: isTerminal,
    };
  }

  // ── Formatting ────────────────────────────────────────────────

  override formatOutput(result: TaskOutputOutput): string {
    const statusIcon =
      result.status === 'completed'
        ? '✅'
        : result.status === 'failed'
          ? '❌'
          : result.status === 'in_progress'
            ? '🔄'
            : '⬜';

    const lines: string[] = [
      `${statusIcon} Task [${result.taskId.slice(0, 8)}] — ${result.status}`,
    ];

    if (result.stdout) {
      lines.push('', '--- stdout ---', result.stdout);
    }
    if (result.stderr) {
      lines.push('', '--- stderr ---', result.stderr);
    }

    return lines.join('\n');
  }
}
