/**
 * cron-scheduler.ts — Cron task scheduler
 *
 * Manages timed prompts from ~/.kode/scheduled_tasks.json. Parses cron
 * expressions, computes next-run times, and fires prompts by enqueueing
 * them into the active Agent Loop via a registered callback.
 *
 * Features:
 *  - Loads persistent (durable=true) tasks from disk on startup
 *  - Computes next fire time for each task using the cron expression
 *  - Schedules timeouts to fire prompts at the correct time
 *  - Deletes one-shot tasks after they fire
 *  - Reference: Claude Code's CronCreate/CronDelete/CronList tools
 *
 * Architecture: The scheduler is a module-level singleton. Register it
 * via getCronScheduler() / setCronScheduler(). The QueryEngine or engine
 * factory should create and store a scheduler instance at boot.
 */

import { EventEmitter } from 'node:events';
import { homedir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Scheduled task descriptor — defined here to avoid cross-package imports.
 * Mirrors the interface from @kode/tools cron-create.ts.
 */
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
// Helpers (re-implemented here to avoid cross-package import cycles)
// ---------------------------------------------------------------------------

function cronMatchesField(field: string, value: number): boolean {
  if (field === '*') return true;
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    return value % step === 0;
  }
  for (const part of field.split(',')) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [start, end] = trimmed.split('-');
      if (value >= parseInt(start!, 10) && value <= parseInt(end!, 10)) return true;
    } else {
      if (parseInt(trimmed, 10) === value) return true;
    }
  }
  return false;
}

function cronComputeNext(cron: string, from: Date): Date {
  const fields = cron.trim().split(/\s+/);
  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const maxIterations = 366 * 24 * 60;
  for (let i = 0; i < maxIterations; i++) {
    if (
      cronMatchesField(fields[0]!, candidate.getMinutes()) &&
      cronMatchesField(fields[1]!, candidate.getHours()) &&
      cronMatchesField(fields[2]!, candidate.getDate()) &&
      cronMatchesField(fields[3]!, candidate.getMonth() + 1) &&
      cronMatchesField(fields[4]!, candidate.getDay())
    ) {
      return candidate;
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  throw new Error('Could not compute next run within 366 days');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CronSchedulerConfig {
  /** Path to scheduled_tasks.json (default: ~/.kode/scheduled_tasks.json) */
  tasksPath?: string;
  /** Callback invoked when a task fires */
  onFire?: (task: ScheduledTask) => void;
  /** Whether to auto-start scheduling (default: true) */
  autoStart?: boolean;
}

/**
 * Callback signature: receives the task that fired and executes its prompt.
 * The callback should enqueue the prompt into the active Agent Loop.
 */
export type CronFireCallback = (task: ScheduledTask) => void;

// ---------------------------------------------------------------------------
// CronScheduler
// ---------------------------------------------------------------------------

export class CronScheduler extends EventEmitter {
  private tasks: Map<string, ScheduledTask> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private tasksPath: string;
  private onFire: CronFireCallback | null;
  private running = false;

  constructor(config: CronSchedulerConfig = {}) {
    super();
    this.tasksPath = config.tasksPath ?? path.join(homedir(), '.kode', 'scheduled_tasks.json');
    this.onFire = config.onFire ?? null;
    if (config.autoStart !== false) {
      this.start();
    }
  }

  // -------------------------------------------------------------------
  // Public: Lifecycle
  // -------------------------------------------------------------------

  /**
   * Load durable tasks from disk and begin scheduling.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.loadFromDisk();
    this.scheduleAll();
  }

  /**
   * Stop all timers and clear in-memory state.
   */
  stop(): void {
    this.running = false;
    for (const [, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  /**
   * Register a fire callback — called when a task's time arrives.
   */
  setFireCallback(cb: CronFireCallback): void {
    this.onFire = cb;
  }

  // -------------------------------------------------------------------
  // Public: Task management
  // -------------------------------------------------------------------

  /**
   * Add a new task to the scheduler. Schedules a timer for it.
   * If durable, also persists to disk.
   */
  addTask(task: ScheduledTask): void {
    this.tasks.set(task.id, task);
    if (task.durable) {
      this.persistToDisk();
    }
    this.scheduleTask(task);
  }

  /**
   * Remove a task by ID. Clears its timer and removes from disk.
   */
  removeTask(id: string): boolean {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    const existed = this.tasks.delete(id);
    if (existed) {
      this.persistToDisk();
    }
    return existed;
  }

  /**
   * List all active tasks.
   */
  listTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get a specific task by ID.
   */
  getTask(id: string): ScheduledTask | undefined {
    return this.tasks.get(id);
  }

  /**
   * Reload tasks from disk (useful after external modifications).
   */
  reload(): void {
    this.loadFromDisk();
    // Reschedule all
    for (const [, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.scheduleAll();
  }

  // -------------------------------------------------------------------
  // Private: Scheduling
  // -------------------------------------------------------------------

  /**
   * Schedule a timer for a single task.
   */
  private scheduleTask(task: ScheduledTask): void {
    // Clear any existing timer for this task
    const existing = this.timers.get(task.id);
    if (existing) {
      clearTimeout(existing);
    }

    const now = new Date();
    let nextRun: Date;
    try {
      nextRun = cronComputeNext(task.cron, now);
    } catch {
      // Invalid cron — skip scheduling
      return;
    }

    const delayMs = Math.max(0, nextRun.getTime() - now.getTime());

    // Clamp to 32-bit signed int max for setTimeout safety (~24.8 days)
    const MAX_TIMEOUT = 2147483647;
    const effectiveDelay = Math.min(delayMs, MAX_TIMEOUT + 1000);

    const timer = setTimeout(() => {
      this.fireTask(task);
    }, effectiveDelay);

    // Allow the process to exit even if timers are pending
    timer.unref();

    this.timers.set(task.id, timer);
  }

  /**
   * Schedule timers for all loaded tasks.
   */
  private scheduleAll(): void {
    for (const [, task] of this.tasks) {
      this.scheduleTask(task);
    }
  }

  /**
   * Fire a task: invoke the callback, handle one-shot deletion, and reschedule recurring.
   */
  private fireTask(task: ScheduledTask): void {
    this.timers.delete(task.id);

    // Invoke the fire callback
    if (this.onFire) {
      try {
        this.onFire(task);
      } catch {
        // Callback errors should not kill the scheduler
      }
    }

    this.emit('fire', task);

    // Update metadata
    task.lastFired = new Date().toISOString();

    if (!task.recurring) {
      // One-shot: delete after firing
      this.tasks.delete(task.id);
      if (task.durable) {
        this.persistToDisk();
      }
      return;
    }

    // Recurring: compute next run and reschedule
    try {
      task.nextRun = cronComputeNext(task.cron, new Date()).toISOString();
    } catch {
      this.tasks.delete(task.id);
      return;
    }

    this.scheduleTask(task);
    if (task.durable) {
      this.persistToDisk();
    }
  }

  // -------------------------------------------------------------------
  // Private: Persistence
  // -------------------------------------------------------------------

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.tasksPath)) return;
      const raw = fs.readFileSync(this.tasksPath, 'utf-8');
      const loaded = JSON.parse(raw) as ScheduledTask[];
      for (const task of loaded) {
        if (task.durable) {
          this.tasks.set(task.id, task);
        }
      }
    } catch {
      // Corrupted file or permissions — start fresh
    }
  }

  private persistToDisk(): void {
    try {
      const dir = path.dirname(this.tasksPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const durableTasks = Array.from(this.tasks.values()).filter((t) => t.durable);
      // Write atomically: tmp file then rename
      const tmpPath = this.tasksPath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(durableTasks, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.tasksPath);
    } catch {
      // Best-effort persistence
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _scheduler: CronScheduler | null = null;

export function getCronScheduler(): CronScheduler | null {
  return _scheduler;
}

export function setCronScheduler(scheduler: CronScheduler): void {
  _scheduler = scheduler;
  // Expose on globalThis for tool integration
  (globalThis as Record<string, unknown>).__kodeCronScheduler = scheduler;
}

export function resetCronScheduler(): void {
  if (_scheduler) {
    _scheduler.stop();
  }
  _scheduler = null;
  delete (globalThis as Record<string, unknown>).__kodeCronScheduler;
}
