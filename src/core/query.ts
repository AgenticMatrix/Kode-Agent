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
  DeferredPermission,
} from './types.js';
import { AgentError, RiskLevel } from './types.js';
import type { ToolContext } from './types.js';
import { ToolRegistry } from './tool-registry.js';
import { PermissionEngine } from './permission.js';
import { SessionManager } from './session.js';
import { CheckpointManager } from './checkpoint.js';
import type { SystemPrompt } from './system-prompt.js';
import type { SystemPromptAssembler } from './system-prompt.js';
import type { HookManager } from './hooks.js';
import type { SubAgentRegistry } from './subagent-registry.js';
import type { AgentRegistry } from './agent-registry.js';
import { estimateTokens } from './token-budget.js';
import { ToolExecutionQueue } from './tool-queue.js';

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
  /** Max concurrent tool executions (default: 32). */
  maxToolConcurrency?: number;
  callModel: (params: CallModelParams) => AsyncGenerator<StreamEvent | AssistantMessage>;
  /** Optional HookManager for lifecycle hook execution */
  hookManager?: HookManager;
  /** SubAgentRegistry for tracking spawned sub-agents */
  subAgentRegistry?: SubAgentRegistry;
  /** SystemPromptAssembler for assembling sub-agent prompts */
  systemPromptAssembler?: SystemPromptAssembler;
  /** AgentRegistry for looking up agent type definitions */
  agentRegistry?: AgentRegistry;
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
// executeSingleTool — run one tool with hooks, checkpoint, tracking
// ---------------------------------------------------------------------------

interface ExecuteSingleToolOpts {
  sessionId: string;
  cwd: string;
  toolRegistry: ToolRegistry;
  checkpointManager: CheckpointManager;
  sessionManager: SessionManager;
  hookManager?: HookManager;
  abortController: AbortController;
  callModel: (params: CallModelParams) => AsyncGenerator<StreamEvent | AssistantMessage>;
  subAgentRegistry?: SubAgentRegistry;
  systemPromptAssembler?: SystemPromptAssembler;
  agentRegistry?: AgentRegistry;
}

async function executeSingleTool(
  toolBlock: ToolUseBlock,
  opts: ExecuteSingleToolOpts,
): Promise<ToolResultBlock> {
  const { sessionId, cwd, toolRegistry, checkpointManager, sessionManager, hookManager, abortController, callModel, subAgentRegistry, systemPromptAssembler, agentRegistry } = opts;
  const toolDef = toolRegistry.get(toolBlock.name)?.definition;

  // PreToolUse hook
  if (hookManager) {
    const { blocked, reason } = await hookManager.onPreToolUse(
      sessionId,
      cwd,
      toolBlock.name,
      toolBlock.input,
    );
    if (blocked) {
      const msg = reason ?? 'Blocked by PreToolUse hook';
      return createToolErrorResult(toolBlock.id, msg);
    }
  }

  // Git checkpoint before destructive operations
  if (toolDef?.riskLevel === 'destructive') {
    await checkpointManager.create({ sessionId, cwd, description: `Pre-${toolBlock.name}` });
  }

  const toolCtx: ToolContext = {
    sessionId,
    cwd,
    signal: abortController.signal,
    agentSpawn: subAgentRegistry && systemPromptAssembler && agentRegistry ? {
      callModel,
      toolRegistry,
      sessionManager,
      subAgentRegistry,
      hookManager,
      systemPromptAssembler,
      agentRegistry,
    } : undefined,
  };
  const toolStartTime = Date.now();

  try {
    const execResult = await toolRegistry.execute(toolBlock.name, toolBlock.input, toolCtx);
    const resultBlock: ToolResultBlock = {
      type: 'tool_result',
      tool_use_id: toolBlock.id,
      content: execResult.content,
      is_error: execResult.isError,
      duration: execResult.duration,
      metadata: execResult.metadata,
    };
    sessionManager.trackTool(toolBlock.name);

    if ((toolBlock.name === 'Write' || toolBlock.name === 'Edit') && toolBlock.input) {
      const input = toolBlock.input as Record<string, unknown>;
      if (typeof input.file_path === 'string') {
        sessionManager.trackModifiedFile(input.file_path);
      }
    }

    hookManager?.onNotification(
      sessionId, cwd,
      resultBlock.is_error ? 'warn' : 'info',
      `Tool ${toolBlock.name} ${resultBlock.is_error ? 'failed' : 'completed'}`,
      { toolName: toolBlock.name, isError: resultBlock.is_error, toolUseId: toolBlock.id },
    ).catch(() => {});

    if (hookManager) {
      const durationMs = Date.now() - toolStartTime;
      hookManager
        .onPostToolUse(
          sessionId, cwd, toolBlock.name, toolBlock.input,
          { output: execResult.content, success: !resultBlock.is_error },
          !resultBlock.is_error, durationMs,
        )
        .catch(() => {});
    }

    return resultBlock;
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);

    if (hookManager) {
      const errObj = error instanceof Error ? error : new Error(errMsg);
      hookManager.onPostToolUseFailure(
        sessionId, cwd, toolBlock.name, toolBlock.input, errObj,
      ).catch(() => {});
      const durationMs = Date.now() - toolStartTime;
      hookManager
        .onPostToolUse(
          sessionId, cwd, toolBlock.name, toolBlock.input,
          { output: errMsg, success: false }, false, durationMs,
        )
        .catch(() => {});
    }

    return createToolErrorResult(toolBlock.id, errMsg);
  }
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
    maxToolConcurrency = 32,
    callModel,
    hookManager,
    agentRegistry,
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
    let stopReason: StopReason = 'end_turn';
    let usage: CompletionUsage = { input_tokens: 0, output_tokens: 0 };

    // Streaming tool execution: tools are enqueued as soon as their
    // input JSON is complete (content_block_stop), not after the full
    // message.  A bounded pool limits concurrent executions.
    interface BuildingBlock {
      id: string;
      name: string;
      inputJson: string;
    }
    let buildingBlock: BuildingBlock | null = null;
    const orderedBlocks: ToolUseBlock[] = [];
    const queue = new ToolExecutionQueue(maxToolConcurrency, abortController.signal);
    const execOpts: ExecuteSingleToolOpts = {
      sessionId,
      cwd,
      toolRegistry,
      checkpointManager,
      sessionManager,
      hookManager,
      abortController,
      callModel,
      subAgentRegistry: config.subAgentRegistry,
      systemPromptAssembler: config.systemPromptAssembler,
      agentRegistry: config.agentRegistry,
    };

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
        // ── Stream events ──────────────────────────────────────────
        if ('type' in event) {
          // Always yield stream events to the TUI first
          yield { type: 'stream_event', event: event as StreamEvent };

          // Track building tool_use blocks from the stream
          if (event.type === 'content_block_start') {
            const cb = (event as { type: 'content_block_start'; content_block: ContentBlock }).content_block;
            if (cb.type === 'tool_use' && cb.id && cb.name) {
              buildingBlock = { id: cb.id, name: cb.name, inputJson: '' };
            }
          }

          if (event.type === 'content_block_delta' && buildingBlock) {
            const delta = (event as { type: 'content_block_delta'; delta: { type: string; partial_json?: string } }).delta;
            if (delta.type === 'input_json_delta' && delta.partial_json) {
              buildingBlock.inputJson += delta.partial_json;
            }
          }

          if (event.type === 'content_block_stop' && buildingBlock) {
            // Tool block input is complete — parse, check permission, enqueue
            const toolBlock: ToolUseBlock = {
              type: 'tool_use',
              id: buildingBlock.id,
              name: buildingBlock.name,
              input: (() => {
                try { return JSON.parse(buildingBlock.inputJson) as Record<string, unknown>; }
                catch { return {}; }
              })(),
            };
            orderedBlocks.push(toolBlock);

            // Permission check + enqueue (may yield for ASK mode)
            if (!abortController.signal.aborted) {
              const toolDef = toolRegistry.get(toolBlock.name)?.definition;
              let permissionResult = await permissionEngine.check(
                {
                  toolName: toolBlock.name,
                  input: toolBlock.input,
                  riskLevel: (toolDef?.riskLevel ?? RiskLevel.MUTATION) as RiskLevel,
                },
                toolDef,
              );

              // PermissionRequest hook
              if (hookManager && permissionResult.behavior !== 'approve') {
                const riskLevelStr = toolDef?.riskLevel ?? RiskLevel.MUTATION;
                const { permissionOverride } = await hookManager.onPermissionRequest(
                  sessionId, cwd, toolBlock.name, toolBlock.input,
                  String(riskLevelStr), permissionResult.behavior,
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

              // deny
              if (!permissionResult.allowed && permissionResult.behavior === 'deny') {
                const reason = permissionResult.reason ?? 'Denied';
                queue.storeError(toolBlock, reason);
                hookManager?.onPermissionDenied(
                  sessionId, cwd, toolBlock.name, toolBlock.input, reason,
                ).catch(() => {});
              } else if (permissionResult.behavior === 'ask_user') {
                // ASK — yield permission_required, await user response
                const toolInput = toolBlock.input as Record<string, unknown>;
                const command = [toolBlock.name, ...Object.entries(toolInput ?? {}).map(([k, v]) => `${k}=${String(v)}`)].join(' ');
                const description =
                  permissionResult.prompt ??
                  toolDef?.description ??
                  `Execute ${toolBlock.name}`;

                yield {
                  type: 'system', subtype: 'progress',
                  data: {
                    toolName: toolBlock.name, toolUseId: toolBlock.id,
                    status: 'started', message: 'Waiting for approval...',
                  },
                };

                let resolve!: (allowed: boolean) => void;
                const promise = new Promise<boolean>((res) => { resolve = res; });
                const deferred: DeferredPermission = {
                  toolName: toolBlock.name, command, description,
                  toolUseId: toolBlock.id, resolve, promise,
                };
                yield { type: 'system', subtype: 'permission_required', deferred };

                const allowed = await new Promise<boolean>((res) => {
                  promise.then((v) => res(v));
                  const onAbort = () => { res(false); };
                  abortController.signal.addEventListener('abort', onAbort, { once: true });
                });

                if (!allowed) {
                  queue.storeError(toolBlock, 'User denied permission');
                  hookManager?.onPermissionDenied(
                    sessionId, cwd, toolBlock.name, toolBlock.input,
                    'User denied permission',
                  ).catch(() => {});
                } else {
                  queue.enqueue(toolBlock, (b) => executeSingleTool(b, execOpts));
                }
              } else {
                // approve — enqueue immediately
                queue.enqueue(toolBlock, (b) => executeSingleTool(b, execOpts));
              }
            } else {
              queue.storeError(toolBlock, 'Interrupted by user');
            }

            buildingBlock = null;
          }

          if (event.type === 'message_stop') {
            const msg = (event as unknown as { type: 'message_stop'; message: AssistantMessage }).message;
            if (msg) {
              assistantMessages.push(msg);
              stopReason = msg.stopReason;
              usage = msg.usage;
            }
          }

          if (event.type === 'message_delta') {
            const delta = (event as { type: 'message_delta'; delta: { stop_reason: StopReason | null } }).delta;
            if (delta.stop_reason) stopReason = delta.stop_reason;
          }
        }

        // ── Direct AssistantMessage (non-streaming fallback) ──────
        if (!('type' in event) && 'role' in event && (event as AssistantMessage).role === 'assistant') {
          const msg = event as AssistantMessage;
          assistantMessages.push(msg);
          stopReason = msg.stopReason ?? stopReason;
          usage = msg.usage ?? usage;

          if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
              if (block.type === 'tool_use') {
                const toolBlock = block as ToolUseBlock;
                orderedBlocks.push(toolBlock);

                // Permission check + enqueue (same logic as streaming path above)
                if (!abortController.signal.aborted) {
                  const toolDef = toolRegistry.get(toolBlock.name)?.definition;
                  let permissionResult = await permissionEngine.check(
                    {
                      toolName: toolBlock.name,
                      input: toolBlock.input,
                      riskLevel: (toolDef?.riskLevel ?? RiskLevel.MUTATION) as RiskLevel,
                    },
                    toolDef,
                  );

                  if (hookManager && permissionResult.behavior !== 'approve') {
                    const riskLevelStr = toolDef?.riskLevel ?? RiskLevel.MUTATION;
                    const { permissionOverride } = await hookManager.onPermissionRequest(
                      sessionId, cwd, toolBlock.name, toolBlock.input,
                      String(riskLevelStr), permissionResult.behavior,
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

                  if (!permissionResult.allowed && permissionResult.behavior === 'deny') {
                    const reason = permissionResult.reason ?? 'Denied';
                    queue.storeError(toolBlock, reason);
                    hookManager?.onPermissionDenied(
                      sessionId, cwd, toolBlock.name, toolBlock.input, reason,
                    ).catch(() => {});
                  } else if (permissionResult.behavior === 'ask_user') {
                    const toolInput = toolBlock.input as Record<string, unknown>;
                    const command = [toolBlock.name, ...Object.entries(toolInput ?? {}).map(([k, v]) => `${k}=${String(v)}`)].join(' ');
                    const description =
                      permissionResult.prompt ??
                      toolDef?.description ??
                      `Execute ${toolBlock.name}`;

                    yield { type: 'system', subtype: 'progress', data: { toolName: toolBlock.name, toolUseId: toolBlock.id, status: 'started', message: 'Waiting for approval...' } };

                    let resolve!: (allowed: boolean) => void;
                    const promise = new Promise<boolean>((res) => { resolve = res; });
                    const deferred: DeferredPermission = { toolName: toolBlock.name, command, description, toolUseId: toolBlock.id, resolve, promise };
                    yield { type: 'system', subtype: 'permission_required', deferred };

                    const allowed = await new Promise<boolean>((res) => {
                      promise.then((v) => res(v));
                      const onAbort = () => { res(false); };
                      abortController.signal.addEventListener('abort', onAbort, { once: true });
                    });

                    if (!allowed) {
                      queue.storeError(toolBlock, 'User denied permission');
                      hookManager?.onPermissionDenied(sessionId, cwd, toolBlock.name, toolBlock.input, 'User denied permission').catch(() => {});
                    } else {
                      queue.enqueue(toolBlock, (b) => executeSingleTool(b, execOpts));
                    }
                  } else {
                    queue.enqueue(toolBlock, (b) => executeSingleTool(b, execOpts));
                  }
                } else {
                  queue.storeError(toolBlock, 'Interrupted by user');
                }
              }
            }
          }
        }

        // Drain progress events after each event so TUI timers start promptly
        for (const pe of queue.drainProgress()) {
          yield { type: 'system', subtype: 'progress', data: pe };
        }
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      for (const block of orderedBlocks) {
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
      cacheCreationInputTokens: usage.cache_creation_input_tokens,
      cacheReadInputTokens: usage.cache_read_input_tokens,
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
    if (stopReason !== 'tool_use' || orderedBlocks.length === 0) {
      return;
    }

    // === Wait for all queued tools to settle ===
    await queue.waitForAll();

    // Drain final progress events
    for (const pe of queue.drainProgress()) {
      yield { type: 'system', subtype: 'progress', data: pe };
    }

    // Assemble results in original parse order
    const toolResults: ToolResultBlock[] = orderedBlocks.map((block) =>
      queue.getResult(block.id) ?? createToolErrorResult(block.id, 'Tool execution skipped'),
    );

    // === PostToolBatch hook (non-blockable) ===
    if (hookManager && toolResults.length > 0) {
      const batchResults = toolResults.map((tr, i) => {
        const toolBlock = orderedBlocks[i];
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

      // Simple truncation: keep last N messages.
      // Never split tool_use/tool_result pairs — if the first kept message
      // has tool_results, walk backwards to include its assistant pair.
      if (messages.length > 30) {
        let cutoff = messages.length - 30;
        while (cutoff > 0) {
          const msg = messages[cutoff];
          if (
            msg?.role === 'user' &&
            Array.isArray(msg.content) &&
            msg.content.some((b) => b.type === 'tool_result')
          ) {
            cutoff--;
          } else {
            break;
          }
        }
        messages = messages.slice(cutoff);
      }
    }
  }
}
