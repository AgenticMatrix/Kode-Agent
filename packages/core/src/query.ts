/**
 * query.ts — AsyncGenerator-driven Agent Loop
 *
 * The core of Kode Agent — an AsyncGenerator that yields messages
 * (stream_event / assistant / user / system / error / progress)
 * consumed by QueryEngine.submitMessage() via for-await.
 *
 * AsyncGenerator-driven Agent Loop.
 * Architecture reference: ARCHITECTURE.md §4.1
 */

import type {
  Message,
  AssistantMessage,
  UserMessage,
  ContentBlock,
  ToolUseBlock,
  ToolResultBlock,
  StreamEvent,
  CompletionUsage,
  StopReason,
  QueryMessage,
  CompactMetadata,
  ToolProgress,
  DeferredPermission,
} from '@kode/shared';
import { AgentError, RiskLevel } from '@kode/shared';
import { ToolRegistry } from './tool-registry.js';
import { PermissionEngine } from './permission/engine.js';
import { SessionManager } from './session.js';
import { CheckpointManager } from './checkpoint.js';
import type { SystemPrompt } from './system-prompt/assembler.js';
import type { ToolContext } from '@kode/shared';
import type { SubagentBus } from '@kode/shared';
import { formatTaskNotification } from '@kode/shared';
import type { HookManager } from './hooks/manager.js';
import { BudgetStore } from './budget-store.js';
import { Compactor } from './context/compactor.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueryConfig {
  sessionId: string;
  cwd: string;
  messages: Message[];
  systemPrompt: SystemPrompt;
  toolRegistry: ToolRegistry;
  permissionEngine: PermissionEngine;
  sessionManager: SessionManager;
  checkpointManager: CheckpointManager;
  abortController: AbortController;
  maxTurns: number;
  maxBudgetUsd?: number;
  contextBudget: number;
  compactThreshold: number;
  callModel: (params: CallModelParams) => AsyncGenerator<StreamEvent | AssistantMessage>;
  /** Optional SubagentBus for tracking background sub-agents */
  subagentBus?: SubagentBus;
  /** Optional agentId — when set, the loop drains SubagentBus.messageQueue each turn */
  agentId?: string;
  /** Optional HookManager for lifecycle hook execution */
  hookManager?: HookManager;
  /** Optional BudgetStore for disk offload of large tool results */
  budgetStore?: BudgetStore;
  /** Optional callback to refresh system prompt each turn. When provided, the
   *  Agent Loop calls this at the start of every turn to get the latest system
   *  prompt (e.g. when MEMORY / Skills / Hooks context changes mid-conversation).
   *  When omitted, the static systemPrompt is used for all turns (backward
   *  compatible). */
  refreshSystemPrompt?: () => Promise<SystemPrompt> | SystemPrompt;
}

export interface CallModelParams {
  system: string;
  messages: Message[];
  tools: unknown[];
  signal: AbortSignal;
}

export type QueryDeps = {
  callModel: (params: CallModelParams) => AsyncGenerator<StreamEvent | AssistantMessage>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createUserMessage(content: ContentBlock[]): UserMessage {
  return { role: 'user', content };
}

function createToolErrorResult(toolUseId: string, error: string): ToolResultBlock {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: error,
    is_error: true,
  };
}

function estimateTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += Math.ceil(msg.content.length / 3.5);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        const text = block.text ?? block.content ?? JSON.stringify(block.input ?? {});
        total += Math.ceil(String(text).length / 3.5);
      }
    }
  }
  return total;
}

/**
 * Extract plain text content from a list of assistant messages.
 * Used by the PostMessage hook to provide a lightweight string
 * representation of the LLM response.
 */
function extractAssistantText(assistantMessages: AssistantMessage[]): string {
  const parts: string[] = [];
  for (const msg of assistantMessages) {
    if (typeof msg.content === 'string') {
      parts.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          parts.push(block.text);
        } else if (block.type === 'tool_use' && block.name) {
          parts.push(`[tool_use: ${block.name}]`);
        } else if (block.type === 'thinking') {
          parts.push('[thinking]');
        }
      }
    }
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// query() — Main Agent Loop
// ---------------------------------------------------------------------------

export async function* query(config: QueryConfig): AsyncGenerator<QueryMessage> {
  const {
    sessionId,
    cwd,
    toolRegistry,
    permissionEngine,
    sessionManager,
    checkpointManager,
    abortController,
    maxTurns,
    maxBudgetUsd,
    contextBudget,
    compactThreshold,
    callModel,
    subagentBus,
    hookManager,
    budgetStore,
  } = config;

  let messages = [...config.messages];
  let systemPrompt = config.systemPrompt;
  let turnCount = 0;
  let totalCost = 0;

  // ── Microcompact: track last user interaction for idle detection ────
  // When a session is resumed after a long idle period (>60min),
  // microcompact clears stale tool results to save context budget.
  let lastUserInteractionTime: number = Date.now();

  // ── Lightweight Compactor instance for microcompact only ────────────
  // Full compaction uses inline logic (Snip strategy); the Compactor
  // instance here provides only the zero-LLM microcompact capability.
  const microcompactor = new Compactor({
    estimateTokens,
    summarizeEnabled: false,
  });

  while (true) {
    // === Exit conditions ===
    if (turnCount >= maxTurns) {
      // ── Notification hook (non-blockable): MAX_TURNS ──────────────
      if (hookManager) {
        hookManager.onNotification(
          sessionId, cwd, 'warn',
          `Exceeded maximum of ${maxTurns} turns`,
          { turnCount, maxTurns },
        ).catch(() => {});
      }
      yield {
        type: 'system',
        subtype: 'error',
        error: new AgentError(`Exceeded maximum of ${maxTurns} turns`, 'MAX_TURNS'),
      };
      return;
    }

    if (maxBudgetUsd && totalCost >= maxBudgetUsd) {
      // ── Notification hook (non-blockable): BUDGET exceeded ────────
      if (hookManager) {
        hookManager.onNotification(
          sessionId, cwd, 'warn',
          `Budget exceeded at $${totalCost.toFixed(2)}`,
          { totalCost, maxBudgetUsd },
        ).catch(() => {});
      }
      yield {
        type: 'system',
        subtype: 'error',
        error: new AgentError(`Budget exceeded at $${totalCost.toFixed(2)}`, 'BUDGET'),
      };
      return;
    }

    if (abortController.signal.aborted) {
      return;
    }

    // === Dynamic system prompt refresh (per turn) ===
    // Moved AFTER exit condition checks (Sprint 7 fix): previously this ran
    // before exit checks, wasting an assembler.assemble() call on the final
    // turn. Now exit conditions short-circuit before the expensive refresh.
    // When refreshSystemPrompt is provided, re-assemble the system prompt
    // at the start of each turn. This allows MEMORY, Skills, and Hooks
    // context to stay fresh as the conversation evolves.
    if (config.refreshSystemPrompt) {
      try {
        systemPrompt = await config.refreshSystemPrompt();
      } catch {
        // If refresh fails, keep the previous system prompt — a stale prompt
        // is better than crashing the loop.
      }
    }

    // === Drain completed sub-agents (SubagentBus integration) ===
    // At the start of each turn, check for background workers that have
    // finished. Inject <task-notification> XML into the message list so
    // the LLM is aware of newly completed sub-agent work.
    if (subagentBus && subagentBus.hasCompleted()) {
      const completed = subagentBus.drainCompleted();
      for (const entry of completed) {
        const notification = formatTaskNotification(entry);
        const notificationMsg: UserMessage = {
          role: 'user',
          content: notification,
        };
        messages.push(notificationMsg);
        yield { type: 'user', message: notificationMsg };
      }
    }

    // === Drain AgentMessage queue (Worker message injection) ===
    // At the start of each turn, check for parent-sent messages queued
    // via AgentMessage tool. Inject them into the Worker's message list
    // so the Worker processes follow-up instructions from Coordinator.
    if (subagentBus && config.agentId) {
      const queued = subagentBus.drainMessageQueue(config.agentId);
      for (const msg of queued) {
        messages.push(msg);
        yield { type: 'user', message: msg };
      }
    }

    // === Get tool definitions for LLM ===
    const toolDefinitions = toolRegistry.getDefinitions().map((def) => ({
      name: def.name,
      description: def.description,
      input_schema: def.inputSchema,
    }));

    // === Stream call to LLM ===
    const assistantMessages: AssistantMessage[] = [];
    const toolUseBlocks: ToolUseBlock[] = [];
    let stopReason: StopReason = 'end_turn';
    let usage: CompletionUsage = { input_tokens: 0, output_tokens: 0 };

    try {
      let systemText = systemPrompt.prompt;

      // === PreMessage hook (blockable) ===
      if (hookManager) {
        const messageSummaries = messages.slice(-10).map((m) => ({
          role: m.role,
          summary: typeof m.content === 'string'
            ? m.content.slice(0, 200)
            : Array.isArray(m.content)
              ? m.content
                  .map((b) =>
                    b.type === 'text'
                      ? (b.text ?? '').slice(0, 100)
                      : `[${b.type}]`,
                  )
                  .join('; ')
              : '',
        }));
        const preMessageResult = await hookManager.onPreMessage(
          sessionId,
          cwd,
          messageSummaries,
          systemText,
          'unknown',
          turnCount,
        );
        if (preMessageResult.blocked) {
          yield {
            type: 'system',
            subtype: 'error',
            error: new AgentError(
              preMessageResult.blockReason ?? 'API call blocked by PreMessage hook',
              'HOOK_BLOCKED',
            ),
          };
          return;
        }
        if (preMessageResult.modifiedSystemPrompt) {
          systemText = preMessageResult.modifiedSystemPrompt;
        }
        if (preMessageResult.injectContext) {
          systemText = `${preMessageResult.injectContext}\n\n${systemText}`;
        }
      }

      for await (const event of callModel({
        system: systemText,
        messages,
        tools: toolDefinitions,
        signal: abortController.signal,
      })) {
        const isStreamEvent = 'type' in event;
        if (
          isStreamEvent &&
          (event.type === 'content_block_start' ||
          event.type === 'content_block_delta' ||
          event.type === 'content_block_stop' ||
          event.type === 'message_start' ||
          event.type === 'message_delta' ||
          event.type === 'message_stop')
        ) {
          yield { type: 'stream_event', event: event as StreamEvent };

          if (event.type === 'message_stop') {
            const msg = (event as unknown as { type: 'message_stop'; message: AssistantMessage }).message;
            if (msg) {
              assistantMessages.push(msg);
              stopReason = msg.stopReason;
              usage = msg.usage;

              if (Array.isArray(msg.content)) {
                for (const block of msg.content) {
                  if (block.type === 'tool_use') {
                    toolUseBlocks.push(block as ToolUseBlock);
                  }
                }
              }
            }
          }

          if (event.type === 'message_delta') {
            const delta = (event as { type: 'message_delta'; delta: { stop_reason: StopReason | null } }).delta;
            if (delta.stop_reason) stopReason = delta.stop_reason;
          }
        }

        // Handle AssistantMessage yielded directly from the callModel generator
        // (provider-adapter.build() returns AssistantMessage which has 'role' not 'type')
        if (!isStreamEvent && 'role' in event && (event as AssistantMessage).role === 'assistant') {
          const msg = event as AssistantMessage;
          assistantMessages.push(msg);
          stopReason = msg.stopReason ?? stopReason;
          usage = msg.usage ?? usage;

          if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
              if (block.type === 'tool_use') {
                toolUseBlocks.push(block as ToolUseBlock);
              }
            }
          }
        }
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      for (const block of toolUseBlocks) {
        const errorMsg = createUserMessage([createToolErrorResult(block.id, errMsg)]);
        messages.push(errorMsg);
        yield { type: 'user', message: errorMsg };
      }

      // ── StopFailure hook (non-blockable) ──────────────────────────
      if (hookManager) {
        const apiError = {
          message: errMsg,
          code: (error as { code?: string })?.code,
          status: (error as { status?: number })?.status,
        };
        hookManager.onStopFailure(sessionId, cwd, apiError, turnCount).catch(() => {});
      }

      yield {
        type: 'system',
        subtype: 'error',
        error: new AgentError(errMsg, 'API_ERROR', true),
      };
      return;
    }

    // Emit assistant messages
    for (const msg of assistantMessages) {
      yield { type: 'assistant', message: msg };
    }

    // === PostMessage hook (non-blockable, observability) ===
    if (hookManager) {
      const assistantText = extractAssistantText(assistantMessages);
      const messageSummaries = messages.slice(-10).map((m) => ({
        role: m.role,
        summary: typeof m.content === 'string'
          ? m.content.slice(0, 200)
          : Array.isArray(m.content)
            ? m.content
                .map((b) =>
                  b.type === 'text'
                    ? (b.text ?? '').slice(0, 100)
                    : `[${b.type}]`,
                )
                .join('; ')
            : '',
      }));
      hookManager.onPostMessage(
        sessionId,
        cwd,
        assistantText,
        'unknown',
        turnCount,
        { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens },
        messageSummaries,
      ).then((result) => {
        // If hook wants to save to memory, queue it for the next turn
        if (result.saveToMemory && config.refreshSystemPrompt && hookManager) {
          // Memory saving is deferred to the session manager;
          // injectContext is handled by injecting into the next system prompt
        }
      }).catch(() => {
        // Non-blockable event: hook failures are silently ignored
      });
    }

    // Track cost
    totalCost += usage.totalCost ?? 0;
    const costEvent: StreamEvent = { type: 'cost_update', totalCost };
    yield { type: 'stream_event', event: costEvent };

    sessionManager.updateUsage({
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
    });
    if (usage.totalCost) sessionManager.addCost(usage.totalCost);

    // === Stop hook (end-of-turn) ===
    if (hookManager) {
      const recentMessages = messages.slice(-5).map((m) => ({
        role: m.role,
        summary: typeof m.content === 'string'
          ? m.content.slice(0, 200)
          : Array.isArray(m.content)
            ? m.content
                .map((b) =>
                  b.type === 'text'
                    ? (b.text ?? '').slice(0, 100)
                    : `[${b.type}]`,
                )
                .join('; ')
            : '',
      }));
      const { shouldStop } = await hookManager.onStop(
        sessionId,
        cwd,
        turnCount,
        recentMessages,
      );
      if (shouldStop) {
        // ── Notification hook (non-blockable): HOOK_STOP ─────────────
        if (hookManager) {
          hookManager.onNotification(
            sessionId, cwd, 'info',
            'Stop requested by hook',
            { turnCount },
          ).catch(() => {});
        }
        yield {
          type: 'system',
          subtype: 'error',
          error: new AgentError(
            'Stop requested by hook',
            'HOOK_STOP',
          ),
        };
        return;
      }
    }

    // === stop_reason is not tool_use → done ===
    if (stopReason !== 'tool_use' || toolUseBlocks.length === 0) {
      return;
    }

    // === Execute tools ===
    const toolResults: ToolResultBlock[] = [];

    for (const toolBlock of toolUseBlocks) {
      if (abortController.signal.aborted) {
        toolResults.push(createToolErrorResult(toolBlock.id, 'Interrupted by user'));
        continue;
      }

      const progress: ToolProgress = { toolName: toolBlock.name, toolUseId: toolBlock.id, status: 'started' };
      yield { type: 'system', subtype: 'progress', data: progress };

      // Permission check
      const toolDef = toolRegistry.get(toolBlock.name)?.definition;
      let permissionResult = await permissionEngine.check(
        {
          toolName: toolBlock.name,
          input: toolBlock.input,
          riskLevel: (toolDef?.riskLevel ?? RiskLevel.MUTATION) as RiskLevel,
        },
        toolDef,
      );

      // === PermissionRequest hook (blockable — can override permission) ===
      if (hookManager && permissionResult.behavior !== 'approve') {
        const riskLevelStr = toolDef?.riskLevel ?? RiskLevel.MUTATION;
        const { permissionOverride } = await hookManager.onPermissionRequest(
          sessionId,
          cwd,
          toolBlock.name,
          toolBlock.input,
          String(riskLevelStr),
          permissionResult.behavior,
        );
        if (permissionOverride === 'auto-approve') {
          permissionResult.allowed = true;
          permissionResult.behavior = 'approve';
        } else if (permissionOverride === 'auto-deny') {
          permissionResult.allowed = false;
          permissionResult.behavior = 'deny';
          permissionResult.reason = `Auto-denied by PermissionRequest hook`;
        }
      }

      // ── Branch: deny ──────────────────────────────────────────
      if (!permissionResult.allowed && permissionResult.behavior === 'deny') {
        toolResults.push(createToolErrorResult(toolBlock.id, permissionResult.reason ?? 'Denied'));

        // === PermissionDenied hook (non-blockable) ===
        if (hookManager) {
          hookManager.onPermissionDenied(
            sessionId, cwd, toolBlock.name, toolBlock.input,
            permissionResult.reason ?? 'Permission denied',
          ).catch(() => {});
        }
        continue;
      }

      // ── Branch: ask_user (Deferred permission) ────────────────
      if (permissionResult.behavior === 'ask_user') {
        const toolInput = toolBlock.input as Record<string, unknown>;
        const command = [toolBlock.name, ...Object.entries(toolInput ?? {}).map(([k, v]) => `${k}=${String(v)}`)].join(' ');
        const description =
          permissionResult.prompt ??
          toolDef?.description ??
          `Execute ${toolBlock.name}`;

        let resolve!: (allowed: boolean) => void;
        const promise = new Promise<boolean>((res) => { resolve = res; });

        const deferred: DeferredPermission = {
          toolName: toolBlock.name,
          command,
          description,
          toolUseId: toolBlock.id,
          resolve,
          promise,
        };

        yield { type: 'system', subtype: 'permission_required', deferred };

        const allowed = await new Promise<boolean>((resolve) => {
          promise.then((v) => resolve(v));
          const onAbort = () => { resolve(false); };
          abortController.signal.addEventListener('abort', onAbort, { once: true });
        });
        if (!allowed) {
          toolResults.push(createToolErrorResult(toolBlock.id, 'User denied permission'));

          // === PermissionDenied hook (non-blockable) ===
          if (hookManager) {
            hookManager.onPermissionDenied(
              sessionId, cwd, toolBlock.name, toolBlock.input,
              'User denied permission',
            ).catch(() => {});
          }

          const progressDenied: ToolProgress = { toolName: toolBlock.name, toolUseId: toolBlock.id, status: 'completed' };
          yield { type: 'system', subtype: 'progress', data: progressDenied };
          continue;
        }
      }

      // === PreToolUse hook ===
      if (hookManager) {
        const { blocked, reason } = await hookManager.onPreToolUse(
          sessionId,
          cwd,
          toolBlock.name,
          toolBlock.input,
        );
        if (blocked) {
          toolResults.push(
            createToolErrorResult(
              toolBlock.id,
              reason ?? `Blocked by PreToolUse hook`,
            ),
          );
          const progressBlocked: ToolProgress = {
            toolName: toolBlock.name,
            toolUseId: toolBlock.id,
            status: 'completed',
            message: `Blocked: ${reason ?? 'PreToolUse hook'}`,
          };
          yield { type: 'system', subtype: 'progress', data: progressBlocked };
          continue;
        }
      }

      // Git checkpoint before destructive operations
      if (toolDef?.riskLevel === 'destructive') {
        await checkpointManager.create({ sessionId, cwd, description: `Pre-${toolBlock.name}` });
      }

      const toolCtx: ToolContext = { sessionId, cwd, signal: abortController.signal };

      const progressRunning: ToolProgress = { toolName: toolBlock.name, toolUseId: toolBlock.id, status: 'running' };
      yield { type: 'system', subtype: 'progress', data: progressRunning };

      const toolStartTime = Date.now();

      try {
        const result = await toolRegistry.execute(toolBlock.name, toolBlock.input, toolCtx);
        const resultBlock: ToolResultBlock = {
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: result.success ? (result.output ?? JSON.stringify(result.data) ?? 'Success') : (result.error ?? 'Error'),
          is_error: !result.success,
        };
        toolResults.push(resultBlock);
        sessionManager.trackTool(toolBlock.name);

        // ── Tool Result Budget: offload large outputs to disk ────────
        if (budgetStore && !resultBlock.is_error && typeof resultBlock.content === 'string') {
          const offloadResult = budgetStore.maybeOffload(
            toolBlock.id,
            toolBlock.name,
            resultBlock.content as string,
            sessionId,
          );
          if (offloadResult.entry) {
            // Replace in-memory content with truncated preview
            resultBlock.content = offloadResult.content;
            // Update the last toolResults entry (it's the same object reference)
            toolResults[toolResults.length - 1] = resultBlock;
          }
        }

        if ((toolBlock.name === 'Write' || toolBlock.name === 'Edit') && toolBlock.input) {
          const input = toolBlock.input as Record<string, unknown>;
          if (typeof input.file_path === 'string') {
            sessionManager.trackModifiedFile(input.file_path);

            // ── Auto-checkpoint: fire-and-forget file snapshot ─────────
            // Non-blocking — failures are silently logged, never thrown.
            const cpFilePath = input.file_path as string;
            checkpointManager.autoCreate({
              sessionId,
              turnNumber: turnCount,
              toolName: toolBlock.name,
              filePath: cpFilePath,
              cwd,
              readAfter: true,
            }).catch(() => {
              // Auto-checkpoint failure is non-fatal
            });
          }
        }

        const progressDone: ToolProgress = {
          toolName: toolBlock.name,
          toolUseId: toolBlock.id,
          status: 'completed',
          is_error: resultBlock.is_error,
          message: resultBlock.is_error
            ? `Error: ${String(resultBlock.content)}`
            : String(resultBlock.content).slice(0, 500),
        };
        yield { type: 'system', subtype: 'progress', data: progressDone };

        // ── Notification hook (non-blockable): tool completed ───────
        if (hookManager) {
          hookManager.onNotification(
            sessionId,
            cwd,
            resultBlock.is_error ? 'warn' : 'info',
            `Tool ${toolBlock.name} ${resultBlock.is_error ? 'failed' : 'completed'}`,
            {
              toolName: toolBlock.name,
              isError: resultBlock.is_error,
              toolUseId: toolBlock.id,
            },
          ).catch(() => {});
        }
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        toolResults.push(createToolErrorResult(toolBlock.id, errMsg));

        // ── PostToolUseFailure hook (non-blockable) ─────────────────
        if (hookManager) {
          const errObj = error instanceof Error ? error : new Error(errMsg);
          hookManager.onPostToolUseFailure(
            sessionId,
            cwd,
            toolBlock.name,
            toolBlock.input,
            errObj,
          ).catch(() => {});
        }

        const progressDone: ToolProgress = {
          toolName: toolBlock.name,
          toolUseId: toolBlock.id,
          status: 'completed',
          is_error: true,
          message: `Error: ${errMsg}`,
        };
        yield { type: 'system', subtype: 'progress', data: progressDone };
      }

      // === PostToolUse hook ===
      if (hookManager) {
        const durationMs = Date.now() - toolStartTime;
        const lastResult = toolResults[toolResults.length - 1];
        const success = lastResult ? !lastResult.is_error : true;
        const output = lastResult?.content ?? '';
        // Fire-and-forget — PostToolUse errors should not block the loop
        hookManager
          .onPostToolUse(
            sessionId,
            cwd,
            toolBlock.name,
            toolBlock.input,
            { output, success },
            success,
            durationMs,
          )
          .catch(() => {
            // Hook failures are non-fatal
          });
      }
    }

    // === PostToolBatch hook (non-blockable) ===
    if (hookManager && toolResults.length > 0) {
      const batchResults = toolResults.map((tr, i) => {
        const toolBlock = toolUseBlocks[i];
        return {
          toolName: toolBlock?.name ?? 'unknown',
          success: !tr.is_error,
          durationMs: 0, // Duration is per-tool, not available in batch context
          summary: typeof tr.content === 'string' ? tr.content.slice(0, 200) : JSON.stringify(tr.content).slice(0, 200),
        };
      });
      hookManager.onPostToolBatch(sessionId, cwd, batchResults).catch(() => {});
    }

    // === Level 2: Aggregate offload check ===
    // If the combined tool output exceeds 200KB, batch-offload ALL results
    // and replace them with an index summary. This prevents a single turn
    // from filling the entire context window.
    if (budgetStore && toolResults.length > 0) {
      const contentList = toolResults
        .filter((tr) => typeof tr.content === 'string')
        .map((tr) => (tr.content as string));
      if (budgetStore.shouldAggregateOffload(contentList)) {
        const aggregateInput = toolResults
          .filter((tr) => !tr.is_error)
          .map((tr, i) => ({
            toolUseId: tr.tool_use_id,
            toolName: `Tool #${i + 1}`, // We don't track tool names through toolResults; use index
            content: typeof tr.content === 'string' ? tr.content as string : JSON.stringify(tr.content),
          }));
        const { content: summaryContent } = budgetStore.batchOffload(aggregateInput, sessionId);
        // Replace all non-error tool result contents with the summary.
        // Error results are kept as-is so the model knows about failures.
        for (const tr of toolResults) {
          if (!tr.is_error && typeof tr.content === 'string') {
            tr.content = `[Offloaded — see summary below]\n${summaryContent}`;
          }
        }
        // De-duplicate: only the first offloaded result carries the summary
        let summaryInjected = false;
        for (const tr of toolResults) {
          if (!tr.is_error && typeof tr.content === 'string' && tr.content.startsWith('[Offloaded')) {
            if (!summaryInjected) {
              summaryInjected = true;
            } else {
              tr.content = `[Offloaded — see first tool result above for index]`;
            }
          }
        }
      }
    }

    // === Inject assistant + tool results in correct API order ===
    // Anthropic API requires alternating roles: user → assistant → user → ...
    // The assistant message (with tool_use blocks) MUST come before the
    // user message (with tool_results), otherwise the API rejects the call.
    // DeepSeek's Anthropic-compatible endpoint silently hangs on this error.
    for (const am of assistantMessages) {
      messages.push(am);
    }

    const userMsg = createUserMessage(toolResults);
    messages.push(userMsg);
    yield { type: 'user', message: userMsg };

    turnCount++;

    // === Microcompact: zero-cost lightweight cleanup ===
    // Runs BEFORE full compaction — clears stale tool results when
    // the session has been idle >60min, saving tokens without LLM cost.
    // Only triggers when there are actual savings (savedTokens > 0).
    {
      const microResult = await microcompactor.microcompact(
        messages,
        lastUserInteractionTime,
      );
      if (microResult.strategy !== 'none' && microResult.removedCount > 0) {
        messages = microResult.messages;
        // Yield a compact boundary so the UI can show a trim indicator
        yield {
          type: 'system',
          subtype: 'compact_boundary',
          compactMetadata: {
            beforeTokens: microResult.savedTokens + estimateTokens(messages),
            afterTokens: estimateTokens(messages),
            strategy: microResult.strategy,
          },
        };
        // Log the savings
        if (hookManager) {
          hookManager.onNotification(
            sessionId,
            cwd,
            'info',
            `[Microcompact] ${microResult.strategy}: removed ${microResult.removedCount} messages, saved ~${microResult.savedTokens.toLocaleString()} tokens`,
            {
              strategy: microResult.strategy,
              removedCount: microResult.removedCount,
              savedTokens: microResult.savedTokens,
            },
          ).catch(() => {});
        }
      }
    }

    // === Context compaction check ===
    const currentTokens = estimateTokens(messages);
    if (currentTokens / contextBudget > compactThreshold) {
      // === PreCompact hook ===
      let injectContext = '';
      if (hookManager) {
        try {
          const result = await hookManager.onPreCompact(
            sessionId,
            cwd,
            messages.length,
            currentTokens,
            contextBudget,
            'snip',
          );
          injectContext = result.injectContext;
        } catch {
          // Hook failures are non-fatal during compaction
        }
      }

      const compactMeta: CompactMetadata = {
        beforeTokens: currentTokens,
        afterTokens: Math.ceil(currentTokens * 0.5),
        strategy: 'snip',
      };
      yield { type: 'system', subtype: 'compact_boundary', compactMetadata: compactMeta };

      // ── Notification hook (non-blockable): compaction completed ──
      if (hookManager) {
        hookManager.onNotification(
          sessionId,
          cwd,
          'info',
          `Context compacted: ${currentTokens} → ${compactMeta.afterTokens} tokens (snip)`,
          {
            beforeTokens: currentTokens,
            afterTokens: compactMeta.afterTokens,
            strategy: 'snip',
          },
        ).catch(() => {});

        // ── PostCompact hook (non-blockable) ─────────────────────────
        const messagesRemoved = currentTokens - compactMeta.afterTokens;
        hookManager.onPostCompact(
          sessionId,
          cwd,
          'snip',
          currentTokens,
          compactMeta.afterTokens,
          messagesRemoved,
        ).catch(() => {});
      }

      // Inject hook context as a system message before snipping
      if (injectContext) {
        const compactCtxMsg: Message = {
          role: 'system',
          content: `[PreCompact hook context]\n${injectContext}`,
        };
        messages.push(compactCtxMsg);
      }

      if (messages.length > 30) {
        messages = messages.slice(-30);
      }
    }
  }
}
