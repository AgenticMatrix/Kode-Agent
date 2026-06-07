/**
 * cron-create.ts — CronCreateTool: Schedule timed prompts (cron jobs)
 *
 * Creates persistent or session-only scheduled tasks that fire prompts
 * at specified cron intervals. Tasks are stored in ~/.coder/scheduled_tasks.json.
 *
 * Reference: Claude Code's CronCreate tool
 */
import { BaseTool, type ToolContext, type ToolDefinition, type ValidationResult } from '@coder/shared';
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
export declare class CronCreateTool extends BaseTool<CronCreateInput, CronCreateOutput> {
    get definition(): ToolDefinition;
    validate(input: unknown): ValidationResult;
    execute(input: CronCreateInput, _ctx: ToolContext): Promise<CronCreateOutput>;
    formatOutput(result: CronCreateOutput): string;
}
export declare function loadScheduledTasks(): ScheduledTask[];
export declare function saveScheduledTasks(tasks: ScheduledTask[]): void;
export declare function getScheduledTasksPath(): string;
//# sourceMappingURL=cron-create.d.ts.map