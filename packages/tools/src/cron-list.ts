/**
 * cron-list.ts — CronListTool: List all scheduled cron tasks
 *
 * Reads ~/.kode/scheduled_tasks.json and returns all tasks with their
 * configuration and next run times.
 *
 * Reference: Claude Code's CronList tool
 */

import { BaseTool, RiskLevel, type ToolContext, type ToolDefinition, type ValidationResult } from '@kode/shared';
import { loadScheduledTasks } from './cron-create.js';
import type { ScheduledTask } from './cron-create.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CronListInput {
  // No input required — lists all tasks
}

export interface CronListOutput {
  tasks: ScheduledTask[];
  count: number;
}

// ---------------------------------------------------------------------------
// CronListTool
// ---------------------------------------------------------------------------

const CRON_LIST_DESCRIPTION = `List all scheduled cron tasks.

Returns every task in ~/.kode/scheduled_tasks.json including their cron
expressions, prompts, recurrence settings, and next scheduled run times.

Use this to review what automated tasks are set up before modifying or
deleting them.`;

export class CronListTool extends BaseTool<CronListInput, CronListOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'CronList',
      description: CRON_LIST_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      riskLevel: RiskLevel.SAFE,
    };
  }

  override validate(_input: unknown): ValidationResult {
    return { valid: true };
  }

  override async execute(_input: CronListInput, _ctx: ToolContext): Promise<CronListOutput> {
    const tasks = loadScheduledTasks();
    return { tasks, count: tasks.length };
  }

  override formatOutput(result: CronListOutput): string {
    if (result.count === 0) {
      return 'No scheduled cron tasks found.';
    }

    const lines: string[] = [`📋 Scheduled Tasks (${result.count}):`, ''];

    for (const task of result.tasks) {
      lines.push(`  ID:       ${task.id}`);
      lines.push(`  Cron:     ${task.cron}`);
      lines.push(`  Prompt:   ${task.prompt}`);
      lines.push(`  Type:     ${task.recurring ? 'recurring' : 'one-shot'}`);
      lines.push(`  Storage:  ${task.durable ? 'durable (disk)' : 'session-only'}`);
      lines.push(`  Next run: ${task.nextRun}`);
      if (task.lastFired) {
        lines.push(`  Last run: ${task.lastFired}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
