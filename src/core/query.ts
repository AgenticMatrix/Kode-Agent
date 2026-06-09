/**
 * query.ts — AsyncGenerator-driven Agent Loop
 *
 * The core agent loop — an AsyncGenerator that yields messages
 * (stream_event / assistant / user / system / error / progress)
 * consumed by QueryEngine.submitMessage() via for-await.
 *
 * Adapted from CoderAgent for ink-chat-tui.
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
} from './types.js';
import { AgentError, RiskLevel } from './types.js';
import type { ToolContext } from './types.js';
import { ToolRegistry } from './tool-registry.js';
import { PermissionEngine } from './permission.js';
import { SessionManager } from './session.js';
import { CheckpointManager } from './checkpoint.js';
import type { SystemPrompt } from './system-prompt.js';
import type { HookManager } from './hooks.js';
import { estimateTokens } from './token-budget.js';

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
  /** Optional HookManager for lifecycle hook execution */
  hookManager?: HookManager;
}

export interface CallModelParams {
  system: string;
  messages: Message[];
  tools: unknown[];
  signal: AbortSignal;
}

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
    hookManager,
  } = config;

  let messages = [...config.messages];
  let systemPrompt = config.systemPrompt;
  let turnCount = 0;
  let totalCost = 0;

  while (true) {
    // === Exit conditions ===
    if (turnCount >= maxTurns) {
      hookManager?.onNotification(
        sessionId, cwd, 'warn',
        `Exceeded maximum of ${maxTurns} turns`,
        { turnCount, maxTurns },
      ).catch(() => {});
      yield {
        type: 'system',
        subtype: 'error',
        error: new AgentError(`Exceeded maximum of ${maxTurns} turns`, 'MAX_TURNS'),
      };
      return;
    }

    if (maxBudgetUsd && totalCost >= maxBudgetUsd) {
      hookManager?.onNotification(
        sessionId, cwd, 'warn',
        `Budget exceeded at $${totalCost.toFixed(2)}`,
        { totalCost, maxBudgetUsd },
      ).catch(() => {});
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

    // === Get tool definitions for LLM ===
    const toolDefinitions = toolRegistry.getDefinitions().map((def) => ({
      name: def.name,
      description: def.description,
      input_schema: def.input_schema,
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

      hookManager?.onStopFailure(sessionId, cwd, { message: errMsg, code: (error as { code?: string })?.code, status: (error as { status?: number })?.status }, turnCount).catch(() => {});

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

    // Track cost
    totalCost += usage.totalCost ?? 0;
    if (usage.totalCost) {
      yield { type: 'stream_event', event: { type: 'cost_update', totalCost } };
    }

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
        hookManager.onNotification(
          sessionId, cwd, 'info',
          'Stop requested by hook',
          { turnCount },
        ).catch(() => {});
        yield {
          type: 'system',
          subtype: 'error',
          error: new AgentError('Stop requested by hook', 'HOOK_STOP'),
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
          permissionResult.reason = 'Auto-denied by PermissionRequest hook';
        }
      }

      // ── Branch: deny ──────────────────────────────────────────
      if (!permissionResult.allowed && permissionResult.behavior === 'deny') {
        toolResults.push(createToolErrorResult(toolBlock.id, permissionResult.reason ?? 'Denied'));
        hookManager?.onPermissionDenied(
          sessionId, cwd, toolBlock.name, toolBlock.input,
          permissionResult.reason ?? 'Permission denied',
        ).catch(() => {});
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

        // Show waiting state — timer should not start yet
        yield {
          type: 'system',
          subtype: 'progress',
          data: {
            toolName: toolBlock.name,
            toolUseId: toolBlock.id,
            status: 'started' as const,
            message: 'Waiting for approval...',
          },
        };

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
          hookManager?.onPermissionDenied(
            sessionId, cwd, toolBlock.name, toolBlock.input,
            'User denied permission',
          ).catch(() => {});

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
              reason ?? 'Blocked by PreToolUse hook',
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
          content: result.content,
          is_error: result.isError,
          duration: result.duration,
          metadata: result.metadata,
        };
        toolResults.push(resultBlock);
        sessionManager.trackTool(toolBlock.name);

        if ((toolBlock.name === 'Write' || toolBlock.name === 'Edit') && toolBlock.input) {
          const input = toolBlock.input as Record<string, unknown>;
          if (typeof input.file_path === 'string') {
            sessionManager.trackModifiedFile(input.file_path);
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

        hookManager?.onNotification(
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
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        toolResults.push(createToolErrorResult(toolBlock.id, errMsg));

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
          .catch(() => {});
      }
    }

    // === PostToolBatch hook (non-blockable) ===
    if (hookManager && toolResults.length > 0) {
      const batchResults = toolResults.map((tr, i) => {
        const toolBlock = toolUseBlocks[i];
        return {
          toolName: toolBlock?.name ?? 'unknown',
          success: !tr.is_error,
          durationMs: 0,
          summary: typeof tr.content === 'string' ? tr.content.slice(0, 200) : JSON.stringify(tr.content).slice(0, 200),
        };
      });
      hookManager.onPostToolBatch(sessionId, cwd, batchResults).catch(() => {});
    }

    // === Inject assistant + tool results in correct API order ===
    for (const am of assistantMessages) {
      messages.push(am);
    }

    const userMsg = createUserMessage(toolResults);
    messages.push(userMsg);
    yield { type: 'user', message: userMsg };

    turnCount++;

    // === Context compaction check (basic snip) ===
    const currentTokens = estimateTokens(messages);
    if (currentTokens / contextBudget > compactThreshold) {
      // PreCompact hook
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

      if (injectContext) {
        const compactCtxMsg: Message = {
          role: 'system',
          content: `[PreCompact hook context]\n${injectContext}`,
        };
        messages.push(compactCtxMsg);
      }

      const compactMeta: CompactMetadata = {
        beforeTokens: currentTokens,
        afterTokens: Math.ceil(currentTokens * 0.5),
        strategy: 'snip',
      };
      yield { type: 'system', subtype: 'compact_boundary', compactMetadata: compactMeta };

      hookManager?.onNotification(
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

      // Simple truncation: keep last N messages
      if (messages.length > 30) {
        messages = messages.slice(-30);
      }
    }
  }
}
