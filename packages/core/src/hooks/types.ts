/**
 * hooks/types.ts — Core-specific hook types
 *
 * Re-exports shared hook types and adds core-specific execution result types.
 * The canonical hook type definitions live in @coder/shared/src/types/hook.ts.
 *
 * Architecture reference: ARCHITECTURE.md §4.6
 */

import type {
  HookEvent,
  HookContext,
  HookResult,
  Hook,
  HookManagerLike,
  BaseHookContext,
  SessionStartContext,
  PreToolUseContext,
  PostToolUseContext,
  PostToolUseFailureContext,
  StopContext,
  StopFailureContext,
  SubagentStartContext,
  SubagentStopContext,
  PreCompactContext,
  SessionEndContext,
  TaskCreatedContext,
  TaskCompletedContext,
  NotificationContext,
  UserPromptSubmitContext,
  PreMessageContext,
  PostMessageContext,
  PostCompactContext,
  InstructionsLoadedContext,
  PermissionRequestContext,
  PermissionDeniedContext,
  WorktreeCreateContext,
  WorktreeRemoveContext,
  PostToolBatchContext,
  ConfigChangeContext,
  SetupContext,
  CwdChangedContext,
  UserPromptExpansionContext,
} from '@coder/shared';

// ---------------------------------------------------------------------------
// Re-exports from shared
// ---------------------------------------------------------------------------

export type {
  HookEvent,
  HookContext,
  HookResult,
  Hook,
  HookManagerLike,
  BaseHookContext,
  SessionStartContext,
  PreToolUseContext,
  PostToolUseContext,
  PostToolUseFailureContext,
  StopContext,
  StopFailureContext,
  SubagentStartContext,
  SubagentStopContext,
  PreCompactContext,
  SessionEndContext,
  TaskCreatedContext,
  TaskCompletedContext,
  NotificationContext,
  UserPromptSubmitContext,
  PreMessageContext,
  PostMessageContext,
  PostCompactContext,
  InstructionsLoadedContext,
  PermissionRequestContext,
  PermissionDeniedContext,
  WorktreeCreateContext,
  WorktreeRemoveContext,
  PostToolBatchContext,
  ConfigChangeContext,
  SetupContext,
  CwdChangedContext,
  UserPromptExpansionContext,
};

// ---------------------------------------------------------------------------
// Core-specific hook types
// ---------------------------------------------------------------------------

/**
 * Result of executing a single hook.
 */
export interface HookExecutionResult {
  /** The hook that was executed */
  hookId: string;
  /** The event being handled */
  event: HookEvent;
  /** The result returned by the handler (null if it timed out) */
  result: HookResult | null;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Error message if execution failed */
  error?: string;
  /** Whether the hook timed out */
  timedOut: boolean;
}

/**
 * Aggregated result of executing all hooks for an event.
 * Used by query.ts to decide whether to block/stop/continue.
 */
export interface AggregatedHookResult {
  /** Individual hook execution results, in priority order */
  results: HookExecutionResult[];
  /** Whether any hook blocked the operation */
  blocked: boolean;
  /** The reason for blocking (from the highest-priority blocking hook) */
  blockReason?: string;
  /** Whether any hook requested the agent to stop (Stop event) */
  shouldStop: boolean;
  /** Aggregated context to inject into the system prompt */
  injectContext: string;
  /** Aggregated metadata (last-write-wins per key across hooks) */
  metadata: Record<string, unknown>;

  // ── UserPromptSubmit ─────────────────────────────────────────────
  /** Augmented prompt from hooks (last non-null wins) */
  augmentedPrompt?: string;

  // ── PreMessage ───────────────────────────────────────────────────
  /** Modified system prompt from hooks (last non-null wins) */
  modifiedSystemPrompt?: string;

  // ── PostMessage ──────────────────────────────────────────────────
  /** Memory save entries from hooks (concatenated) */
  saveToMemory?: string;

  // ── PermissionRequest ────────────────────────────────────────────
  /** Permission override from hooks (last non-null wins) */
  permissionOverride?: 'auto-approve' | 'auto-deny';

  // ── WorktreeCreate ───────────────────────────────────────────────
  /** Override worktree name from hooks (last non-null wins) */
  worktreeName?: string;

  // ── UserPromptExpansion ───────────────────────────────────────────
  /** Override the expanded prompt (UserPromptExpansion, last non-null wins) */
  expandedPromptOverride?: string;
}

/**
 * Create an empty aggregated hook result.
 */
export function createEmptyAggregatedResult(): AggregatedHookResult {
  return {
    results: [],
    blocked: false,
    shouldStop: false,
    injectContext: '',
    metadata: {},
    augmentedPrompt: undefined,
    modifiedSystemPrompt: undefined,
    saveToMemory: undefined,
    permissionOverride: undefined,
    worktreeName: undefined,
    expandedPromptOverride: undefined,
  };
}

/**
 * Reduce individual HookExecutionResults into an AggregatedHookResult.
 * Blocking takes precedence (first encountered blocks).
 * injectedContext is concatenated from all non-null results.
 */
export function aggregateHookResults(
  results: HookExecutionResult[],
): AggregatedHookResult {
  const aggregated: AggregatedHookResult = {
    results,
    blocked: false,
    shouldStop: false,
    injectContext: '',
    metadata: {},
    augmentedPrompt: undefined,
    modifiedSystemPrompt: undefined,
    saveToMemory: undefined,
    permissionOverride: undefined,
    worktreeName: undefined,
    expandedPromptOverride: undefined,
  };

  for (const r of results) {
    if (!r.result) continue;

    if (r.result.blocked && !aggregated.blocked) {
      aggregated.blocked = true;
      aggregated.blockReason = r.result.reason ?? `Blocked by hook "${r.hookId}"`;
    }

    if (r.result.shouldStop) {
      aggregated.shouldStop = true;
    }

    if (r.result.injectContext) {
      aggregated.injectContext += (aggregated.injectContext ? '\n\n' : '') + r.result.injectContext;
    }

    if (r.result.metadata) {
      Object.assign(aggregated.metadata, r.result.metadata);
    }

    // UserPromptSubmit: augmentedPrompt (last non-null wins)
    if (r.result.augmentedPrompt) {
      aggregated.augmentedPrompt = r.result.augmentedPrompt;
    }

    // PreMessage: modifiedSystemPrompt (last non-null wins)
    if (r.result.modifiedSystemPrompt) {
      aggregated.modifiedSystemPrompt = r.result.modifiedSystemPrompt;
    }

    // PostMessage: saveToMemory (concatenated)
    if (r.result.saveToMemory) {
      aggregated.saveToMemory = (aggregated.saveToMemory ? aggregated.saveToMemory + '\n' : '') + r.result.saveToMemory;
    }

    // PermissionRequest: permissionOverride (last non-null wins)
    if (r.result.permissionOverride) {
      aggregated.permissionOverride = r.result.permissionOverride;
    }

    // WorktreeCreate: worktreeName (last non-null wins)
    if (r.result.worktreeName) {
      aggregated.worktreeName = r.result.worktreeName;
    }

    // UserPromptExpansion: expandedPromptOverride (last non-null wins)
    if (r.result.expandedPromptOverride) {
      aggregated.expandedPromptOverride = r.result.expandedPromptOverride;
    }
  }

  return aggregated;
}
