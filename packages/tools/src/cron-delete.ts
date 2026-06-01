/**
 * cron-delete.ts — CronDeleteTool: Remove a scheduled cron task
 *
 * Deletes a task by its ID from the in-process scheduler and optionally
 * from the persistent scheduled_tasks.json file.
 *
 * Reference: Claude Code's CronDelete tool
 */

import { BaseTool, RiskLevel, type ToolContext, type ToolDefinition, type ValidationResult } from '@kode/shared';
import { loadScheduledTasks, saveScheduledTasks } from './cron-create.js';
import type { ScheduledTask } from './cron-create.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CronDeleteInput {
  /** Task ID (returned by CronCreate) */
  id: string;
}

export interface CronDeleteOutput {
  id: string;
  deleted: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// CronDeleteTool
// ---------------------------------------------------------------------------

const CRON_DELETE_DESCRIPTION = `Remove a scheduled cron task by its ID.

The ID is returned by CronCreate when the task was originally created.
This permanently removes the task from the scheduler and (if durable) from disk.`;

export class CronDeleteTool extends BaseTool<CronDeleteInput, CronDeleteOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'CronDelete',
      description: CRON_DELETE_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task ID to delete (returned by CronCreate)' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.MUTATION,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as CronDeleteInput;
    if (!typed || typeof typed !== 'object') {
      return { valid: false, errors: [{ path: '', message: 'Input must be an object' }] };
    }
    if (typeof typed.id !== 'string' || typed.id.trim().length === 0) {
      return { valid: false, errors: [{ path: 'id', message: 'ID must be a non-empty string' }] };
    }
    return { valid: true };
  }

  override async execute(input: CronDeleteInput, _ctx: ToolContext): Promise<CronDeleteOutput> {
    // Remove from disk
    let deletedFromDisk = false;
    try {
      const tasks = loadScheduledTasks();
      const before = tasks.length;
      const filtered = tasks.filter((t) => t.id !== input.id);
      if (filtered.length < before) {
        saveScheduledTasks(filtered);
        deletedFromDisk = true;
      }
    } catch {
      // Best effort
    }

    // Remove from in-process scheduler
    if (typeof (globalThis as Record<string, unknown>).__kodeCronScheduler !== 'undefined') {
      const scheduler = (globalThis as Record<string, unknown>).__kodeCronScheduler as {
        removeTask: (id: string) => boolean;
      };
      scheduler.removeTask(input.id);
    }

    return {
      id: input.id,
      deleted: deletedFromDisk,
      message: deletedFromDisk
        ? `Task ${input.id} deleted successfully`
        : `Task ${input.id} was not found in persistent storage`,
    };
  }

  override formatOutput(result: CronDeleteOutput): string {
    return result.deleted
      ? `🗑️ ${result.message}`
      : `⚠️ ${result.message}`;
  }
}
