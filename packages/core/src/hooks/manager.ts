/**
 * hooks/manager.ts — HookManager
 *
 * Loads and executes hooks registered for lifecycle events.
 * Hooks can be:
 *   1. Shell commands (string) — executed as child processes via execFile
 *   2. JavaScript functions — executed in-process with a timeout wrapper
 *
 * Hook files live in ~/.coder/hooks/ as JSON config files. Each file describes
 * one or more hooks with their event, handler, and configuration.
 *
 * Architecture reference: ARCHITECTURE.md §4.6
 */

import { execFile } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { promisify } from 'node:util';

import type {
  Hook,
  HookEvent,
  HookContext,
  HookResult,
  HookManagerLike,
} from './types.js';

import {
  createEmptyAggregatedResult,
  aggregateHookResults,
} from './types.js';

import type {
  HookExecutionResult,
  AggregatedHookResult,
  SessionStartContext,
} from './types.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default timeout for hook execution (30 seconds) */
const DEFAULT_HOOK_TIMEOUT_MS = 30_000;

/** Directory where hook JSON configuration files are stored */
const HOOKS_DIR = join(homedir(), '.coder', 'hooks');

// ---------------------------------------------------------------------------
// Hook file format (~/.coder/hooks/*.json)
// ---------------------------------------------------------------------------

interface HookFileEntry {
  id: string;
  event: HookEvent;
  description?: string;
  command?: string;
  handler?: string;
  timeout?: number;
  enabled?: boolean;
  priority?: number;
}

interface HookFile {
  hooks: HookFileEntry[];
}

// ---------------------------------------------------------------------------
// HookManager
// ---------------------------------------------------------------------------

export class HookManager implements HookManagerLike {
  private hooks: Map<string, Hook> = new Map();
  private hooksByEvent: Map<HookEvent, Hook[]> = new Map();

  constructor() {
    // Pre-populate event buckets
    const events: HookEvent[] = [
      'SessionStart', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
      'Stop', 'StopFailure',
      'SubagentStart', 'SubagentStop', 'PreCompact', 'SessionEnd',
      'TaskCreated', 'TaskCompleted', 'Notification',
      'UserPromptSubmit', 'PreMessage', 'PostMessage',
      'PostCompact', 'InstructionsLoaded', 'PermissionRequest',
      'PermissionDenied', 'WorktreeCreate', 'WorktreeRemove', 'PostToolBatch',
      'ConfigChange', 'Setup', 'CwdChanged', 'UserPromptExpansion',
    ];
    for (const event of events) {
      this.hooksByEvent.set(event, []);
    }

    // Load hooks from disk
    this.loadFromDisk();
  }

  // ---------------------------------------------------------------------------
  // HookManagerLike implementation
  // ---------------------------------------------------------------------------

  /**
   * Register a new hook at runtime.
   */
  register(hook: Hook): void {
    this.hooks.set(hook.id, hook);
    const bucket = this.hooksByEvent.get(hook.event);
    if (bucket) {
      bucket.push(hook);
      // Sort by priority descending (higher = runs first)
      bucket.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    }
  }

  /**
   * Remove a hook by ID.
   */
  unregister(hookId: string): void {
    const hook = this.hooks.get(hookId);
    if (!hook) return;

    this.hooks.delete(hookId);

    const bucket = this.hooksByEvent.get(hook.event);
    if (bucket) {
      const idx = bucket.findIndex((h) => h.id === hookId);
      if (idx !== -1) bucket.splice(idx, 1);
    }
  }

  /**
   * Execute all registered hooks for an event (async).
   *
   * Hooks are executed in parallel for efficiency. Each hook has its own
   * timeout. Results are aggregated and returned.
   */
  async execute(
    event: HookEvent,
    ctx: Partial<HookContext>,
  ): Promise<HookResult[]> {
    const bucket = this.hooksByEvent.get(event);
    if (!bucket || bucket.length === 0) return [];

    const enabledHooks = bucket.filter((h) => h.enabled !== false);
    if (enabledHooks.length === 0) return [];

    const fullCtx: HookContext = {
      event,
      sessionId: ctx.sessionId ?? '',
      cwd: ctx.cwd ?? process.cwd(),
      timestamp: new Date(),
      ...ctx,
    } as HookContext;

    const results = await Promise.all(
      enabledHooks.map((hook) => this.executeOne(hook, fullCtx)),
    );

    return results
      .filter((r): r is HookResult => r !== null);
  }

  /**
   * Execute hooks synchronously for the SessionStart event.
   *
   * Shell-based hooks are skipped (cannot run synchronously).
   * In-process function hooks are called directly.
   */
  executeSync(
    event: 'SessionStart',
    ctx: Partial<SessionStartContext>,
  ): HookResult[] {
    const bucket = this.hooksByEvent.get(event);
    if (!bucket || bucket.length === 0) return [];

    const results: HookResult[] = [];

    for (const hook of bucket) {
      if (hook.enabled === false) continue;

      // Only in-process function handlers can run synchronously
      if (typeof hook.handler !== 'function') continue;

      const fullCtx: SessionStartContext = {
        event: 'SessionStart',
        sessionId: ctx.sessionId ?? '',
        cwd: ctx.cwd ?? process.cwd(),
        timestamp: new Date(),
        ...ctx,
      };

      try {
        const result = hook.handler(fullCtx);
        // If it returns a promise, skip (cannot await synchronously)
        if (result instanceof Promise) continue;
        results.push(result);
      } catch {
        // Hook errors are non-fatal
      }
    }

    return results;
  }

  /**
   * Execute all hooks for an event and return an aggregated summary.
   * This is the main entry point used by query.ts and compactor.ts.
   */
  async executeAndAggregate(
    event: HookEvent,
    ctx: Partial<HookContext>,
  ): Promise<AggregatedHookResult> {
    const bucket = this.hooksByEvent.get(event);
    if (!bucket || bucket.length === 0) return createEmptyAggregatedResult();

    const enabledHooks = bucket.filter((h) => h.enabled !== false);
    if (enabledHooks.length === 0) return createEmptyAggregatedResult();

    const fullCtx: HookContext = {
      event,
      sessionId: ctx.sessionId ?? '',
      cwd: ctx.cwd ?? process.cwd(),
      timestamp: new Date(),
      ...ctx,
    } as HookContext;

    const executions = await Promise.all(
      enabledHooks.map((hook) => this.executeOneWithTiming(hook, fullCtx)),
    );

    return aggregateHookResults(executions);
  }

  /**
   * List all registered hooks.
   */
  list(): Hook[] {
    return Array.from(this.hooks.values());
  }

  /**
   * Get hooks registered for a specific event.
   */
  listByEvent(event: HookEvent): Hook[] {
    return this.hooksByEvent.get(event) ?? [];
  }

  // ---------------------------------------------------------------------------
  // Lifecycle convenience methods (used by query.ts)
  // ---------------------------------------------------------------------------

  /**
   * Execute PreToolUse hooks. Returns whether the tool should be blocked.
   */
  async onPreToolUse(
    sessionId: string,
    cwd: string,
    toolName: string,
    input: unknown,
  ): Promise<{ blocked: boolean; reason?: string }> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'PreToolUse',
      toolName,
      input,
      rawInput: input,
    };
    const aggregated = await this.executeAndAggregate('PreToolUse', ctx);
    return { blocked: aggregated.blocked, reason: aggregated.blockReason };
  }

  /**
   * Execute PostToolUse hooks. Returns injectable context and metadata.
   */
  async onPostToolUse(
    sessionId: string,
    cwd: string,
    toolName: string,
    input: unknown,
    result: unknown,
    success: boolean,
    durationMs: number,
  ): Promise<void> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'PostToolUse',
      toolName,
      input,
      result,
      success,
      durationMs,
    };
    await this.execute('PostToolUse', ctx);
  }

  /**
   * Execute Stop hooks at the end of each turn.
   */
  async onStop(
    sessionId: string,
    cwd: string,
    turnCount: number,
    recentMessages: Array<{ role: string; summary: string }>,
  ): Promise<{ shouldStop: boolean }> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'Stop',
      turnCount,
      recentMessages,
    };
    const aggregated = await this.executeAndAggregate('Stop', ctx);
    return { shouldStop: aggregated.shouldStop };
  }

  /**
   * Execute PreCompact hooks before context compaction.
   */
  async onPreCompact(
    sessionId: string,
    cwd: string,
    messageCount: number,
    currentTokens: number,
    budgetTokens: number,
    strategy: string,
  ): Promise<{ injectContext: string }> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'PreCompact',
      messageCount,
      currentTokens,
      budgetTokens,
      strategy: strategy as 'snip' | 'auto' | 'summarize',
    };
    const aggregated = await this.executeAndAggregate('PreCompact', ctx);
    return { injectContext: aggregated.injectContext };
  }

  /**
   * Execute SessionStart hooks. Called during system prompt assembly.
   */
  async onSessionStart(
    sessionId: string,
    cwd: string,
  ): Promise<{ injectContext: string; systemPromptAdditions: string[] }> {
    const ctx: Partial<SessionStartContext> = {
      event: 'SessionStart',
      sessionId,
      cwd,
      timestamp: new Date(),
    };

    // Try sync first for in-process hooks
    const syncResults = this.executeSync('SessionStart', ctx);

    // Then async for shell-based hooks
    const asyncResults = await this.execute('SessionStart', ctx);

    const allResults = [...syncResults, ...asyncResults];
    let injectContext = '';
    const systemPromptAdditions: string[] = [];

    for (const r of allResults) {
      if (r.injectContext) {
        injectContext += (injectContext ? '\n\n' : '') + r.injectContext;
      }
      if (r.systemPromptAdditions) {
        systemPromptAdditions.push(...r.systemPromptAdditions);
      }
    }

    return { injectContext, systemPromptAdditions };
  }

  /**
   * Execute SessionEnd hooks during session shutdown.
   */
  async onSessionEnd(
    sessionId: string,
    cwd: string,
    turnCount: number,
    totalCost: number,
    totalTokens: number,
  ): Promise<void> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'SessionEnd',
      turnCount,
      totalCost,
      totalTokens,
    };
    await this.execute('SessionEnd', ctx);
  }

  /**
   * Execute SubagentStart hooks when a sub-agent/Worker is launched.
   *
   * Called by the SubagentBus / runAgent callback at the start of
   * background agent execution. Allows hooks to log, monitor, or inject
   * context for the sub-agent session.
   */
  async onSubagentStart(
    sessionId: string,
    cwd: string,
    subagentName: string,
    subagentPrompt: string,
    allowedTools: string[] = [],
  ): Promise<{ injectContext: string }> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'SubagentStart',
      subagentName,
      subagentPrompt,
      allowedTools,
    };
    const aggregated = await this.executeAndAggregate('SubagentStart', ctx);
    return { injectContext: aggregated.injectContext };
  }

  /**
   * Execute SubagentStop hooks when a sub-agent/Worker completes or fails.
   *
   * Called by the SubagentBus / runAgent callback when background agent
   * execution finishes (success, error, or abort). Provides summary info
   * including success status, output summary, token usage, and duration.
   */
  async onSubagentStop(
    sessionId: string,
    cwd: string,
    subagentName: string,
    success: boolean,
    summary: string,
    tokenUsage: number,
    durationMs: number,
  ): Promise<void> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'SubagentStop',
      subagentName,
      success,
      summary,
      tokenUsage,
      durationMs,
    };
    await this.execute('SubagentStop', ctx);
  }

  // ---------------------------------------------------------------------------
  // Phase 5: New Hook convenience methods (Sprint 7)
  // ---------------------------------------------------------------------------

  /**
   * Execute PostToolUseFailure hooks when a tool throws an exception.
   *
   * Called in the catch block of tool execution in query.ts.
   * Non-blockable — the tool has already failed, this hook is for
   * observability (logging, monitoring, desktop notifications).
   *
   * @param sessionId - Current session identifier
   * @param cwd - Working directory
   * @param toolName - Name of the tool that failed
   * @param input - The tool input that caused the failure
   * @param error - The caught error object
   */
  async onPostToolUseFailure(
    sessionId: string,
    cwd: string,
    toolName: string,
    input: unknown,
    error: Error,
  ): Promise<void> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'PostToolUseFailure',
      toolName,
      input,
      error: {
        message: error.message,
        stack: error.stack,
      },
    };
    // Fire-and-forget — PostToolUseFailure errors should not block the loop
    this.execute('PostToolUseFailure', ctx).catch(() => {
      // Non-blockable event: hook failures are silently ignored
    });
  }

  /**
   * Execute StopFailure hooks when an API error terminates the Agent Loop.
   *
   * Called in the API error catch block in query.ts.
   * Non-blockable — the loop has already failed, this hook is for
   * diagnostics and error reporting.
   *
   * @param sessionId - Current session identifier
   * @param cwd - Working directory
   * @param error - The API error that caused the failure
   * @param turnCount - Turns completed before the failure
   */
  async onStopFailure(
    sessionId: string,
    cwd: string,
    error: { message: string; code?: string; status?: number },
    turnCount: number,
  ): Promise<void> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'StopFailure',
      error,
      turnCount,
    };
    // Fire-and-forget — StopFailure should not delay termination
    this.execute('StopFailure', ctx).catch(() => {
      // Non-blockable event: hook failures are silently ignored
    });
  }

  /**
   * Execute TaskCreated hooks when a background task or sub-agent is spawned.
   *
   * Called by the SubagentBus / runAgent callback at task creation time.
   * Non-blockable — the task is already queued, this hook is for tracking
   * and observability.
   *
   * @param sessionId - Parent session identifier
   * @param cwd - Working directory
   * @param taskId - Unique task identifier
   * @param taskType - Type of task: 'subagent', 'cron', or 'background'
   * @param prompt - Task description / prompt (truncated to 500 chars)
   * @param toolSet - Allowed tool names (empty = unrestricted)
   */
  async onTaskCreated(
    sessionId: string,
    cwd: string,
    taskId: string,
    taskType: 'subagent' | 'cron' | 'background',
    prompt?: string,
    toolSet?: string[],
  ): Promise<void> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'TaskCreated',
      taskId,
      taskType,
      prompt,
      toolSet,
    };
    // Fire-and-forget — TaskCreated should not block the spawn
    this.execute('TaskCreated', ctx).catch(() => {
      // Non-blockable event: hook failures are silently ignored
    });
  }

  /**
   * Execute TaskCompleted hooks when a background task or sub-agent finishes.
   *
   * Called by the SubagentBus / runAgent callback on completion, failure,
   * or kill. Non-blockable — the task has already ended, this hook is for
   * observability.
   *
   * @param sessionId - Parent session identifier
   * @param cwd - Working directory
   * @param taskId - Unique task identifier
   * @param status - Final status: 'completed', 'failed', or 'killed'
   * @param summary - Human-readable summary of what the task accomplished
   * @param usage - Resource usage metrics (tokens, tool calls, duration)
   */
  async onTaskCompleted(
    sessionId: string,
    cwd: string,
    taskId: string,
    status: 'completed' | 'failed' | 'killed',
    summary?: string,
    usage?: { tokens: number; toolCalls: number; durationMs: number },
  ): Promise<void> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'TaskCompleted',
      taskId,
      status,
      summary,
      usage,
    };
    // Fire-and-forget — TaskCompleted should not block post-cleanup
    this.execute('TaskCompleted', ctx).catch(() => {
      // Non-blockable event: hook failures are silently ignored
    });
  }

  /**
   * Execute Notification hooks for system-level events.
   *
   * Called at key nodes in query.ts: tool completion, compaction completion,
   * error yield. Non-blockable — purely informational, allows hooks to log,
   * send desktop notifications, etc.
   *
   * @param sessionId - Current session identifier
   * @param cwd - Working directory
   * @param level - Severity: 'info', 'warn', or 'error'
   * @param message - Human-readable notification message
   * @param metadata - Optional structured data (tool name, error details, etc.)
   */
  async onNotification(
    sessionId: string,
    cwd: string,
    level: 'info' | 'warn' | 'error',
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'Notification',
      level,
      message,
      metadata,
    };
    // Fire-and-forget — Notification should never block the loop
    this.execute('Notification', ctx).catch(() => {
      // Non-blockable event: hook failures are silently ignored
    });
  }

  // ---------------------------------------------------------------------------
  // Phase 5 Batch 2: UserPromptSubmit / PreMessage / PostMessage (P0)
  // ---------------------------------------------------------------------------

  /**
   * Execute UserPromptSubmit hooks when the user submits a prompt.
   *
   * Called by QueryEngine.submitMessage() BEFORE the user input enters
   * the Agent Loop. This is a BLOCKABLE event — hooks can intercept
   * dangerous commands, augment the prompt, or reject the submission.
   *
   * Timeout: 5 seconds (shorter than default — this blocks the user).
   * On timeout, the submission proceeds (blocked=false) to avoid UX hang.
   *
   * @returns blocked=true with reason if any hook blocks the submission
   * @returns augmentedPrompt if any hook provides a replacement prompt
   */
  async onUserPromptSubmit(
    sessionId: string,
    cwd: string,
    prompt: string,
    metadata?: { model?: string; provider?: string },
  ): Promise<{ blocked: boolean; blockReason?: string; augmentedPrompt?: string }> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'UserPromptSubmit',
      prompt,
      metadata,
    };
    // Use 5s total timeout — blocks user input, must be responsive
    const aggregated = await this.executeAndAggregateWithTimeout('UserPromptSubmit', ctx, 5_000);
    return {
      blocked: aggregated.blocked,
      blockReason: aggregated.blockReason,
      augmentedPrompt: aggregated.augmentedPrompt,
    };
  }

  /**
   * Execute PreMessage hooks before messages are sent to the LLM API.
   *
   * Called in query.ts after system prompt assembly and before callModel().
   * BLOCKABLE — hooks can prevent the API call or modify messages/prompt.
   *
   * Performance: only the last 10 messages are passed to shell hooks
   * (truncation happens in executeShellHook). Function hooks get the full
   * array for in-process inspection.
   *
   * NOTE: modifiedMessages is not yet supported in HookResult because
   * message modification requires deep serialization. Hooks can use
   * injectContext and modifiedSystemPrompt to influence the LLM call.
   *
   * @returns blocked=true to cancel the API call
   * @returns injectContext to prepend to the system prompt
   * @returns modifiedSystemPrompt to replace the system prompt entirely
   */
  async onPreMessage(
    sessionId: string,
    cwd: string,
    messages: Array<{ role: string; summary: string }>,
    systemPrompt: string,
    model: string,
    turnCount: number,
  ): Promise<{ blocked: boolean; blockReason?: string; injectContext?: string; modifiedSystemPrompt?: string }> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'PreMessage',
      // Only pass message summaries for shell hook safety; function hooks
      // that need full messages should use direct sessionManager access.
      messages: messages.slice(-10) as unknown[] as import('@coder/shared').Message[],
      systemPrompt,
      model,
      turnCount,
    };
    const aggregated = await this.executeAndAggregateWithTimeout('PreMessage', ctx, 5_000);
    return {
      blocked: aggregated.blocked,
      blockReason: aggregated.blockReason,
      injectContext: aggregated.injectContext || undefined,
      modifiedSystemPrompt: aggregated.modifiedSystemPrompt,
    };
  }

  /**
   * Execute PostMessage hooks after an LLM response is received.
   *
   * Called in query.ts after the assistant message is assembled and
   * emitted. NON-BLOCKABLE — the response has already been consumed.
   * Hooks can extract knowledge for memory or inject context for the
   * next turn.
   *
   * @returns injectContext to prepend to the next turn's system prompt
   * @returns saveToMemory text to persist to the memory store
   */
  async onPostMessage(
    sessionId: string,
    cwd: string,
    messageContent: string,
    model: string,
    turnCount: number,
    usage: { input_tokens: number; output_tokens: number },
    messages: Array<{ role: string; summary: string }>,
  ): Promise<{ injectContext?: string; saveToMemory?: string }> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'PostMessage',
      // Use a lightweight message representation to avoid serializing
      // full AssistantMessage (which contains ContentBlock[] arrays).
      message: { role: 'assistant', content: messageContent, usage } as unknown as import('@coder/shared').AssistantMessage,
      messages: messages.slice(-10) as unknown[] as import('@coder/shared').Message[],
      model,
      turnCount,
      usage,
    };
    const aggregated = await this.executeAndAggregateWithTimeout('PostMessage', ctx, 10_000);
    return {
      injectContext: aggregated.injectContext || undefined,
      saveToMemory: aggregated.saveToMemory,
    };
  }

  // ---------------------------------------------------------------------------
  // Phase 5 P1: Important Scenario Hook Methods (Sprint 7)
  // ---------------------------------------------------------------------------

  /**
   * Execute PostCompact hooks after context compaction completes.
   * Non-blockable — compaction has already finished.
   */
  async onPostCompact(
    sessionId: string,
    cwd: string,
    strategy: string,
    beforeTokens: number,
    afterTokens: number,
    messagesRemoved: number,
  ): Promise<void> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'PostCompact',
      strategy,
      beforeTokens,
      afterTokens,
      messagesRemoved,
    };
    this.execute('PostCompact', ctx).catch(() => {});
  }

  /**
   * Execute InstructionsLoaded hooks after system prompt assembly.
   * Non-blockable — the prompt is already assembled.
   */
  async onInstructionsLoaded(
    sessionId: string,
    cwd: string,
    sources: string[],
    totalTokens: number,
  ): Promise<void> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'InstructionsLoaded',
      sources,
      totalTokens,
    };
    this.execute('InstructionsLoaded', ctx).catch(() => {});
  }

  /**
   * Execute PermissionRequest hooks before a permission decision.
   * BLOCKABLE — hooks can override the permission result.
   *
   * @returns permissionOverride: 'auto-approve' or 'auto-deny' to override
   */
  async onPermissionRequest(
    sessionId: string,
    cwd: string,
    toolName: string,
    input: unknown,
    riskLevel: string,
    originalBehavior: 'approve' | 'deny' | 'ask_user',
  ): Promise<{ permissionOverride?: 'auto-approve' | 'auto-deny' }> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'PermissionRequest',
      toolName,
      input,
      riskLevel,
      originalBehavior,
    };
    const aggregated = await this.executeAndAggregateWithTimeout('PermissionRequest', ctx, 3_000);
    return {
      permissionOverride: aggregated.permissionOverride,
    };
  }

  /**
   * Execute PermissionDenied hooks when a tool permission is denied.
   * Non-blockable — the denial has already occurred.
   */
  async onPermissionDenied(
    sessionId: string,
    cwd: string,
    toolName: string,
    input: unknown,
    reason: string,
  ): Promise<void> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'PermissionDenied',
      toolName,
      input,
      reason,
    };
    this.execute('PermissionDenied', ctx).catch(() => {});
  }

  /**
   * Execute WorktreeCreate hooks before creating a git worktree.
   * BLOCKABLE — hooks can prevent worktree creation.
   */
  async onWorktreeCreate(
    sessionId: string,
    cwd: string,
    name: string,
    baseRef: string,
  ): Promise<{ blocked: boolean; blockReason?: string; worktreeName?: string }> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'WorktreeCreate',
      name,
      baseRef,
    };
    const aggregated = await this.executeAndAggregateWithTimeout('WorktreeCreate', ctx, 5_000);
    return {
      blocked: aggregated.blocked,
      blockReason: aggregated.blockReason,
      worktreeName: aggregated.worktreeName,
    };
  }

  /**
   * Execute WorktreeRemove hooks when a worktree is being removed.
   * Non-blockable — the removal has already been decided.
   */
  async onWorktreeRemove(
    sessionId: string,
    cwd: string,
    name: string,
    kept: boolean,
  ): Promise<void> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'WorktreeRemove',
      name,
      kept,
    };
    this.execute('WorktreeRemove', ctx).catch(() => {});
  }

  /**
   * Execute PostToolBatch hooks after a batch of tools completes.
   * Non-blockable — tool execution has finished. Hooks can inspect
   * batch results for diagnostics or logging.
   */
  async onPostToolBatch(
    sessionId: string,
    cwd: string,
    toolResults: Array<{
      toolName: string;
      success: boolean;
      durationMs: number;
      summary: string;
    }>,
  ): Promise<void> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'PostToolBatch',
      toolResults,
    };
    this.execute('PostToolBatch', ctx).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Phase 5 P2: Configuration & Environment Hook Methods (Sprint 7)
  // ---------------------------------------------------------------------------

  /**
   * Execute ConfigChange hooks when configuration changes.
   *
   * Called when config options are modified (model switch, permission mode
   * change, etc.). Non-blockable — the config has already been applied.
   * Hooks can log changes or trigger side effects.
   *
   * @param sessionId - Current session identifier
   * @param cwd - Working directory
   * @param changedKeys - Which config fields changed
   * @param newValues - New values for changed keys
   * @param previousValues - Previous values (where tracked, optional)
   */
  async onConfigChange(
    sessionId: string,
    cwd: string,
    changedKeys: string[],
    newValues: Record<string, unknown>,
    previousValues?: Record<string, unknown>,
  ): Promise<void> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'ConfigChange',
      changedKeys,
      newValues,
      previousValues,
    };
    this.execute('ConfigChange', ctx).catch(() => {});
  }

  /**
   * Execute Setup hooks when a fresh session is created for the first time.
   *
   * Called by QueryEngine.init() on the first session. Non-blockable —
   * the session already exists. Hooks can run one-time setup tasks like
   * creating directories, installing dependencies, etc.
   *
   * @param sessionId - Current session identifier
   * @param cwd - Working directory
   * @param isFresh - Whether this is a fresh session (no prior message history)
   * @param model - Current model
   * @param provider - Current provider (optional)
   */
  async onSetup(
    sessionId: string,
    cwd: string,
    isFresh: boolean,
    model?: string,
    provider?: string,
  ): Promise<void> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'Setup',
      isFresh,
      model,
      provider,
    };
    this.execute('Setup', ctx).catch(() => {});
  }

  /**
   * Execute CwdChanged hooks when the working directory changes.
   *
   * Called when cd command or --cwd flag changes the directory.
   * Non-blockable — the directory has already changed. Hooks can
   * reload project-specific config or update the environment.
   *
   * @param sessionId - Current session identifier
   * @param cwd - The NEW working directory (after change)
   * @param previousCwd - The previous working directory
   */
  async onCwdChanged(
    sessionId: string,
    cwd: string,
    previousCwd: string,
  ): Promise<void> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'CwdChanged',
      previousCwd,
      newCwd: cwd,
    };
    this.execute('CwdChanged', ctx).catch(() => {});
  }

  /**
   * Execute UserPromptExpansion hooks after UserPromptSubmit and prompt
   * expansion, before the expanded prompt enters the Agent Loop.
   *
   * Called by QueryEngine.submitMessage() after UserPromptSubmit.
   * BLOCKABLE — hooks can intercept the final expanded prompt before
   * it's sent to the model.
   *
   * @param sessionId - Current session identifier
   * @param cwd - Working directory
   * @param originalPrompt - The original user input before expansion
   * @param expandedPrompt - The expanded/augmented prompt (may be same as original)
   * @returns blocked=true if any hook blocks
   * @returns expandedPromptOverride if any hook provides a replacement
   */
  async onUserPromptExpansion(
    sessionId: string,
    cwd: string,
    originalPrompt: string,
    expandedPrompt: string,
  ): Promise<{ blocked: boolean; blockReason?: string; expandedPromptOverride?: string }> {
    const ctx: Partial<HookContext> = {
      sessionId,
      cwd,
      event: 'UserPromptExpansion',
      originalPrompt,
      expandedPrompt,
    };
    const aggregated = await this.executeAndAggregateWithTimeout('UserPromptExpansion', ctx, 5_000);
    return {
      blocked: aggregated.blocked,
      blockReason: aggregated.blockReason,
      expandedPromptOverride: aggregated.expandedPromptOverride,
    };
  }

  // ---------------------------------------------------------------------------
  // Phase 5 P2: HTTP and MCP Tool Hook Support (Sprint 7)
  // ---------------------------------------------------------------------------

  /**
   * Register an HTTP-based hook. The handler is an HttpHookConfig object
   * that specifies a URL to POST hook context to.
   */
  registerHttpHook(hook: Hook): void {
    if (hook.type !== 'http') {
      throw new Error(`registerHttpHook requires hook type 'http', got '${hook.type ?? 'undefined'}'`);
    }
    this.register(hook);
  }

  /**
   * Execute an HTTP hook by POSTing the context to the configured URL.
   *
   * Implements a POST-only protocol: serializes the HookContext as JSON
   * and sends it in the request body. The response body is parsed as
   * JSON and treated as a HookResult.
   *
   * Timeout is controlled by HttpHookConfig.timeout (defaults to 5000ms).
   */
  private async executeHttpHook(
    config: import('@coder/shared').HttpHookConfig,
    ctx: HookContext,
    timeoutMs: number,
  ): Promise<HookResult | null> {
    const url = config.url;
    const method = config.method ?? 'POST';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config.headers,
    };
    const body = config.includeContext !== false ? JSON.stringify(ctx) : undefined;
    const requestTimeout = config.timeout ?? timeoutMs;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), requestTimeout);

      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return null; // Non-2xx → treated as hook failure (non-fatal)
      }

      const text = await response.text();
      if (text.trim()) {
        try {
          return JSON.parse(text) as HookResult;
        } catch {
          // Not valid JSON — treat the output as injectContext
          return { injectContext: text.trim() };
        }
      }

      return null;
    } catch {
      // Network error, timeout, DNS failure — all non-fatal
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private: hook execution with timeout
  // ---------------------------------------------------------------------------

  /**
   * Like executeAndAggregate, but with a configurable overall timeout.
   * Used by blockable hooks where we must not hang the user.
   */
  private async executeAndAggregateWithTimeout(
    event: HookEvent,
    ctx: Partial<HookContext>,
    timeoutMs: number,
  ): Promise<AggregatedHookResult> {
    const bucket = this.hooksByEvent.get(event);
    if (!bucket || bucket.length === 0) return createEmptyAggregatedResult();

    const enabledHooks = bucket.filter((h) => h.enabled !== false);
    if (enabledHooks.length === 0) return createEmptyAggregatedResult();

    const fullCtx: HookContext = {
      event,
      sessionId: ctx.sessionId ?? '',
      cwd: ctx.cwd ?? process.cwd(),
      timestamp: new Date(),
      ...ctx,
    } as HookContext;

    const timeoutPromise = new Promise<HookExecutionResult[]>((resolve) => {
      setTimeout(() => {
        // On timeout, return empty results — the operation proceeds (not blocked)
        resolve([]);
      }, timeoutMs);
    });

    const executionPromise = Promise.all(
      enabledHooks.map((hook) => this.executeOneWithTiming(hook, fullCtx)),
    );

    const executions = await Promise.race([executionPromise, timeoutPromise]);
    return aggregateHookResults(executions);
  }

  // ---------------------------------------------------------------------------
  // Private: hook execution
  // ---------------------------------------------------------------------------

  /**
   * Execute a single hook and return its result (null if it fails/times out).
   */
  private async executeOne(
    hook: Hook,
    ctx: HookContext,
  ): Promise<HookResult | null> {
    try {
      const timeoutMs = hook.timeout ?? DEFAULT_HOOK_TIMEOUT_MS;

      if (hook.type === 'http' && typeof hook.handler === 'object' && 'url' in hook.handler) {
        return await this.executeHttpHook(
          hook.handler as import('@coder/shared').HttpHookConfig,
          ctx,
          timeoutMs,
        );
      }

      if (typeof hook.handler === 'string') {
        return await this.executeShellHook(hook.handler, ctx, timeoutMs);
      }

      if (typeof hook.handler === 'function') {
        return await this.executeFunctionHook(hook.handler, ctx, timeoutMs);
      }

      return null;
    } catch {
      // Hook errors are non-fatal — never crash the agent loop
      return null;
    }
  }

  /**
   * Execute a single hook and return a timed execution result.
   */
  private async executeOneWithTiming(
    hook: Hook,
    ctx: HookContext,
  ): Promise<HookExecutionResult> {
    const start = Date.now();
    let result: HookResult | null = null;
    let error: string | undefined;
    let timedOut = false;

    try {
      result = await this.executeOne(hook, ctx);
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : String(err);
    }

    const durationMs = Date.now() - start;
    const timeoutMs = hook.timeout ?? DEFAULT_HOOK_TIMEOUT_MS;

    // Detect if it timed out by checking if result is null and duration ~= timeout
    if (!result && !error && durationMs >= timeoutMs - 100) {
      timedOut = true;
      error = `Hook "${hook.id}" timed out after ${timeoutMs}ms`;
    }

    return {
      hookId: hook.id,
      event: hook.event,
      result,
      durationMs,
      error,
      timedOut,
    };
  }

  /**
   * Execute a shell command as a hook handler.
   *
   * Passes the hook context as JSON via stdin. Expects JSON on stdout.
   * Falls back to treating stdout as `{ injectContext: stdout }` if JSON
   * parsing fails.
   */
  private async executeShellHook(
    command: string,
    ctx: HookContext,
    timeoutMs: number,
  ): Promise<HookResult | null> {
    const ctxJson = JSON.stringify(ctx);

    try {
      const { stdout, stderr } = await execFileAsync('sh', ['-c', command], {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024, // 1MB
        env: {
          ...process.env,
          CODER_HOOK_EVENT: ctx.event,
          CODER_HOOK_CTX: ctxJson,
        },
      });

      // Try to parse stdout as JSON HookResult
      if (stdout.trim()) {
        try {
          return JSON.parse(stdout.trim()) as HookResult;
        } catch {
          // Not valid JSON — treat the output as injectContext
          return { injectContext: stdout.trim() };
        }
      }

      // If stdout is empty but stderr has content, log it but don't fail
      if (stderr.trim()) {
        return {
          metadata: { stderr: stderr.trim() },
        };
      }

      return null;
    } catch (err: unknown) {
      const e = err as { code?: string; killed?: boolean; signal?: string };
      // Timeout or other process error — non-fatal
      if (e.killed || e.signal === 'SIGTERM') {
        return null; // Timed out — handled by executeOneWithTiming
      }
      // Shell command returned non-zero exit code — also non-fatal
      return null;
    }
  }

  /**
   * Execute a JavaScript function as a hook handler with a timeout wrapper.
   */
  private async executeFunctionHook(
    handler: (ctx: HookContext) => Promise<HookResult>,
    ctx: HookContext,
    timeoutMs: number,
  ): Promise<HookResult | null> {
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    });

    const result = await Promise.race([
      handler(ctx).catch(() => null),
      timeoutPromise,
    ]);

    return result;
  }

  // ---------------------------------------------------------------------------
  // Private: disk loading
  // ---------------------------------------------------------------------------

  /**
   * Load hook configuration files from ~/.coder/hooks/.
   *
   * Each file is a JSON file with a `hooks` array.
   * Example:
   *   {
   *     "hooks": [
   *       {
   *         "id": "pre-tool-logger",
   *         "event": "PreToolUse",
   *         "description": "Log all tool invocations",
   *         "command": "echo '{\"injectContext\": \"Tool was used\"}'",
   *         "timeout": 5000,
   *         "priority": 10
   *       }
   *     ]
   *   }
   */
  private loadFromDisk(): void {
    if (!existsSync(HOOKS_DIR)) return;

    let entries: HookFileEntry[] = [];

    try {
      const dirents = readdirSync(HOOKS_DIR);
      for (const dirent of dirents) {
        if (!dirent.endsWith('.json')) continue;
        const filePath = join(HOOKS_DIR, dirent);

        try {
          // Skip directories and non-files
          if (!statSync(filePath).isFile()) continue;

          const raw = readFileSync(filePath, 'utf-8');
          const parsed: HookFile = JSON.parse(raw);

          if (Array.isArray(parsed.hooks)) {
            entries = entries.concat(parsed.hooks);
          }
        } catch {
          // Skip unparseable files
        }
      }
    } catch {
      // Directory listing failed — no hooks loaded
      return;
    }

    for (const entry of entries) {
      if (!entry.id || !entry.event) continue;

      // Determine the handler: command (shell string) or handler (function name)
      // At load time, only shell commands are available. JS functions must be
      // registered programmatically via register().
      const handler: string = entry.command ?? entry.handler ?? '';
      if (!handler) continue;

      const hook: Hook = {
        id: entry.id,
        event: entry.event as HookEvent,
        description: entry.description,
        handler,
        timeout: entry.timeout ?? DEFAULT_HOOK_TIMEOUT_MS,
        enabled: entry.enabled !== false,
        priority: entry.priority ?? 0,
      };

      this.register(hook);
    }
  }
}
