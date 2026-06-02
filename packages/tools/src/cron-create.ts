/**
 * cron-create.ts — CronCreateTool: Schedule timed prompts (cron jobs)
 *
 * Creates persistent or session-only scheduled tasks that fire prompts
 * at specified cron intervals. Tasks are stored in ~/.coder/scheduled_tasks.json.
 *
 * Reference: Claude Code's CronCreate tool
 */

import { randomUUID } from 'node:crypto';
import { BaseTool, RiskLevel, type ToolContext, type ToolDefinition, type ValidationResult } from '@coder/shared';

// ---------------------------------------------------------------------------
// Scheduled Task persistence path
// ---------------------------------------------------------------------------

import { homedir } from 'node:os';
import { join } from 'node:path';
const SCHEDULED_TASKS_PATH = join(homedir(), '.coder', 'scheduled_tasks.json');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CronCreateInput {
  /** Standard 5-field cron expression: "minute hour dom month dow" */
  cron: string;
  /** Prompt to enqueue when the task fires */
  prompt: string;
  /** true = recurring schedule, false = one-shot (auto-delete after fire) */
  recurring?: boolean;
  /** true = persist to disk across restarts, false = session-only */
  durable?: boolean;
}

export interface CronCreateOutput {
  /** Unique job ID returned by CronCreate */
  id: string;
  cron: string;
  prompt: string;
  recurring: boolean;
  durable: boolean;
  /** ISO timestamp of next scheduled fire */
  nextRun: string;
}

export interface ScheduledTask {
  id: string;
  cron: string;
  prompt: string;
  recurring: boolean;
  durable: boolean;
  createdAt: string;
  nextRun: string;
  lastFired?: string;
}

// ---------------------------------------------------------------------------
// Cron field validation
// ---------------------------------------------------------------------------

const FIELD_RANGE: Record<string, [number, number]> = {
  minute: [0, 59],
  hour: [0, 23],
  dom: [1, 31],
  month: [1, 12],
  dow: [0, 7],
};

function validateCronField(value: string, field: string): string | null {
  const [min, max] = FIELD_RANGE[field] ?? [0, 0];

  // Wildcard
  if (value === '*') return null;

  // Step: */N
  if (value.startsWith('*/')) {
    const step = parseInt(value.slice(2), 10);
    if (isNaN(step) || step < 1) return `Invalid step in ${field}: ${value}`;
    return null;
  }

  // Check lists
  for (const part of value.split(',')) {
    const trimmed = part.trim();
    // Range: N-M
    if (trimmed.includes('-')) {
      const [start, end] = trimmed.split('-');
      const s = parseInt(start!, 10);
      const e = parseInt(end!, 10);
      if (isNaN(s) || isNaN(e) || s < min || e > max || s > e) {
        return `Invalid range in ${field}: ${trimmed}`;
      }
      continue;
    }
    // Single value
    const num = parseInt(trimmed, 10);
    if (isNaN(num) || num < min || num > max) {
      return `Invalid value in ${field}: ${trimmed}`;
    }
  }

  return null;
}

function validateCronExpression(expr: string): string | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return `Cron expression must have exactly 5 fields, got ${fields.length}`;
  }

  const fieldNames = ['minute', 'hour', 'dom', 'month', 'dow'];
  for (let i = 0; i < 5; i++) {
    const error = validateCronField(fields[i]!, fieldNames[i]!);
    if (error) return error;
  }

  return null;
}

// ---------------------------------------------------------------------------
// CronCreateTool
// ---------------------------------------------------------------------------

const CRON_CREATE_DESCRIPTION = `Schedule a prompt to be enqueued at a future time.
Use for both recurring schedules and one-shot reminders.

Uses standard 5-field cron in the user's local timezone: minute hour day-of-month month day-of-week.
"0 9 * * *" means 9am local — no timezone conversion needed.

Examples:
  - "*/5 * * * *" → every 5 minutes
  - "0 9 * * 1-5" → weekdays at 9am
  - "30 14 28 2 *" → Feb 28 at 2:30pm (one-shot: recurring=false)

For recurring=true (default), the task fires on every cron match until deleted or auto-expired.
For recurring=false, the task fires once at the next match then auto-deletes.

Set durable=true to persist the task to disk and survive restarts.`;

export class CronCreateTool extends BaseTool<CronCreateInput, CronCreateOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'CronCreate',
      description: CRON_CREATE_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          cron: { type: 'string', description: 'Standard 5-field cron expression (minute hour dom month dow)' },
          prompt: { type: 'string', description: 'Prompt to enqueue when task fires' },
          recurring: { type: 'boolean', description: 'true = recurring, false = one-shot (default: true)' },
          durable: { type: 'boolean', description: 'true = persist to disk, false = session-only (default: false)' },
        },
        required: ['cron', 'prompt'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.MUTATION,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as CronCreateInput;
    if (!typed || typeof typed !== 'object') {
      return { valid: false, errors: [{ path: '', message: 'Input must be an object' }] };
    }
    if (typeof typed.cron !== 'string' || typed.cron.trim().length === 0) {
      return { valid: false, errors: [{ path: 'cron', message: 'Cron expression must be a non-empty string' }] };
    }
    if (typeof typed.prompt !== 'string' || typed.prompt.trim().length === 0) {
      return { valid: false, errors: [{ path: 'prompt', message: 'Prompt must be a non-empty string' }] };
    }

    const cronError = validateCronExpression(typed.cron);
    if (cronError) {
      return { valid: false, errors: [{ path: 'cron', message: cronError }] };
    }

    return { valid: true };
  }

  override async execute(input: CronCreateInput, _ctx: ToolContext): Promise<CronCreateOutput> {
    const id = randomUUID();
    const now = new Date();
    const nextRun = computeNextRun(input.cron, now);

    const task: ScheduledTask = {
      id,
      cron: input.cron,
      prompt: input.prompt,
      recurring: input.recurring ?? true,
      durable: input.durable ?? false,
      createdAt: now.toISOString(),
      nextRun: nextRun.toISOString(),
    };

    // Register with in-process scheduler if available
    if (typeof (globalThis as Record<string, unknown>).__coderCronScheduler !== 'undefined') {
      const scheduler = (globalThis as Record<string, unknown>).__coderCronScheduler as {
        addTask: (task: ScheduledTask) => void;
      };
      scheduler.addTask(task);
    }

    return {
      id,
      cron: input.cron,
      prompt: input.prompt,
      recurring: input.recurring ?? true,
      durable: input.durable ?? false,
      nextRun: nextRun.toISOString(),
    };
  }

  override formatOutput(result: CronCreateOutput): string {
    return `✅ Cron task created\n  ID: ${result.id}\n  Cron: ${result.cron}\n  Prompt: ${result.prompt}\n  Recurring: ${result.recurring}\n  Durable: ${result.durable}\n  Next run: ${result.nextRun}`;
  }
}

// ---------------------------------------------------------------------------
// Cron next-run computation
// ---------------------------------------------------------------------------

/**
 * Compute the next run time from a cron expression and reference date.
 * This is a simplified implementation that iterates minute-by-minute up
 * to a maximum of 366 days in the future.
 */
function computeNextRun(cron: string, from: Date): Date {
  const fields = cron.trim().split(/\s+/);
  const minuteField = fields[0]!;
  const hourField = fields[1]!;
  const domField = fields[2]!;
  const monthField = fields[3]!;
  const dowField = fields[4]!;

  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1); // start from next minute

  const maxIterations = 366 * 24 * 60; // 366 days in minutes

  for (let i = 0; i < maxIterations; i++) {
    const minute = candidate.getMinutes();
    const hour = candidate.getHours();
    const dom = candidate.getDate();
    const month = candidate.getMonth() + 1; // 1-indexed
    const dow = candidate.getDay(); // 0=Sunday

    if (
      matchesField(minuteField, minute) &&
      matchesField(hourField, hour) &&
      matchesField(domField, dom) &&
      matchesField(monthField, month) &&
      matchesField(dowField, dow)
    ) {
      return candidate;
    }

    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  throw new Error('Could not compute next run within 366 days');
}

function matchesField(field: string, value: number): boolean {
  if (field === '*') return true;

  // Step: */N
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    return value % step === 0;
  }

  // Lists and ranges
  for (const part of field.split(',')) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [start, end] = trimmed.split('-');
      const s = parseInt(start!, 10);
      const e = parseInt(end!, 10);
      if (value >= s && value <= e) return true;
    } else {
      if (parseInt(trimmed, 10) === value) return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Helpers for scheduler integration
// ---------------------------------------------------------------------------

export function loadScheduledTasks(): ScheduledTask[] {
  try {
    const fs = require('node:fs');
    if (!fs.existsSync(SCHEDULED_TASKS_PATH)) return [];
    const raw = fs.readFileSync(SCHEDULED_TASKS_PATH, 'utf-8');
    return JSON.parse(raw) as ScheduledTask[];
  } catch {
    return [];
  }
}

export function saveScheduledTasks(tasks: ScheduledTask[]): void {
  try {
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = path.dirname(SCHEDULED_TASKS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SCHEDULED_TASKS_PATH, JSON.stringify(tasks, null, 2), 'utf-8');
  } catch {
    // Silently fail — persistence is best-effort for session tasks
  }
}

export function getScheduledTasksPath(): string {
  return SCHEDULED_TASKS_PATH;
}
