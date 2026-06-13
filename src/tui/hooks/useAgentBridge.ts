/**
 * useAgentBridge.ts — Bridge from QueryEngine AsyncGenerator to TUI React state.
 *
 * Connects the new core/ architecture (QueryEngine + query.ts AsyncGenerator)
 * to the existing TUI rendering layer (chatReducer + ContentBlock-based components).
 *
 * Key function: map QueryEngine.submitMessage() events → ChatAction dispatches.
 */

import { useCallback, useRef } from 'react';
import type { QueryEngine, QueryEngineEvent } from '../../core/query-engine.js';
import type {
  Message,
  ContentBlock as TuiContentBlock,
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
  ToolResultBlock,
  ChatAction,
  ApprovalRequest,
  BlockDeltaType,
} from '../../types.js';
import { nextMessageId } from './useChatReducer.js';
import { setPendingApproval, getPendingApproval } from './approval-store.js';

/** Throttle interval for batched delta dispatches (ms). */
const DELTA_FLUSH_INTERVAL = 60;

interface PendingDelta {
  messageId: number;
  deltaType: BlockDeltaType;
  text: string;
}

// ---------------------------------------------------------------------------
// Block mapping: core ContentBlock → TUI ContentBlock
// ---------------------------------------------------------------------------

function mapCoreBlockToTui(
  block: { type: string; text?: string; thinking?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: string | Array<{ type: string; text?: string }>; is_error?: boolean },
): TuiContentBlock {
  switch (block.type) {
    case 'text':
      return { type: 'text', content: block.text ?? '' } satisfies TextBlock;

    case 'thinking':
      return { type: 'thinking', content: block.thinking ?? '' } satisfies ThinkingBlock;

    case 'tool_use':
      return {
        type: 'tool_use',
        toolName: block.name ?? 'unknown',
        toolId: block.id ?? '',
        input: block.input ?? {},
        state: 'pending' as const,
      };

    case 'tool_result': {
      const contentStr = typeof block.content === 'string'
        ? block.content
        : (Array.isArray(block.content)
          ? block.content.map((c) => c.text ?? '').join('')
          : '');
      return {
        type: 'tool_result',
        toolId: block.tool_use_id ?? '',
        toolName: '',
        content: contentStr,
        isError: block.is_error ?? false,
        duration: (block as Record<string, unknown>).duration as number | undefined,
        metadata: (block as Record<string, unknown>).metadata as Record<string, unknown> | undefined,
      };
    }

    case 'image':
      return { type: 'text', content: '[Image]' };

    default:
      return { type: 'text', content: '' };
  }
}

// ---------------------------------------------------------------------------
// Helper: create a TUI Message from blocks
// ---------------------------------------------------------------------------

function createAssistantMessage(id: number, blocks: TuiContentBlock[]): Message {
  const textContent = blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.content)
    .join('');
  const thinkingBlock = blocks.find((b): b is ThinkingBlock => b.type === 'thinking');

  return {
    id,
    role: 'assistant',
    content: textContent,
    blocks,
    thinking: thinkingBlock?.content,
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// useAgentBridge
// ---------------------------------------------------------------------------

export interface AgentBridgeDeps {
  engine: QueryEngine;
  dispatch: React.Dispatch<ChatAction>;
}

/**
 * Hook that provides `runAgentTurn`, which pipes user input through
 * QueryEngine.submitMessage() and maps the resulting events to TUI state.
 *
 * The QueryEngine handles the full agent loop (API → tool execution →
 * permission → repeat), so this bridge is purely a translation layer.
 */
export function useAgentBridge({ engine, dispatch }: AgentBridgeDeps) {
  // Map tool_use_id → toolName for identifying read results
  const toolNameMapRef = useRef<Map<string, string>>(new Map());

  // ── Delta throttling: batch APPEND_BLOCK_DELTA dispatches to reduce
  //    re-renders during streaming so terminal text selection isn't disrupted.
  const pendingDeltasRef = useRef<PendingDelta[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushDeltas = useCallback(() => {
    const deltas = pendingDeltasRef.current;
    pendingDeltasRef.current = [];
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    for (const d of deltas) {
      dispatch({ type: 'APPEND_BLOCK_DELTA', messageId: d.messageId, deltaType: d.deltaType, text: d.text });
    }
  }, [dispatch]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = setTimeout(flushDeltas, DELTA_FLUSH_INTERVAL);
  }, [flushDeltas]);

  /**
   * Run a single agent turn: user input → QueryEngine → dispatch → React render.
   */
  const runAgentTurn = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0) return;

      // ── Create and dispatch user message ────────────────────
      const userMsg: Message = {
        id: nextMessageId(),
        role: 'user',
        content: trimmed,
        blocks: [{ type: 'text', content: trimmed } satisfies TextBlock],
        timestamp: Date.now(),
      };
      dispatch({ type: 'ADD_USER_MESSAGE', message: userMsg });

      // ── Agent loop via QueryEngine ──────────────────────────
      try {
        let currentAssistantId: number | null = null;
        let pendingBlocks: TuiContentBlock[] = [];

        for await (const event of engine.submitMessage(trimmed)) {
          switch (event.type) {
            // ── Message event (stream_event | assistant | user | progress) ──
            case 'message': {
              const msg = event.data as {
                type: string;
                event?: { type: string; index?: number; content_block?: Record<string, unknown>; delta?: Record<string, unknown>; message?: Record<string, unknown> };
                message?: { role: string; content: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: string | Array<{ type: string; text?: string }>; is_error?: boolean }> };
                subtype?: string;
              };

              // ── Stream event: block-level streaming ────────
              if (msg.type === 'stream_event' && msg.event) {
                const ev = msg.event;
                switch (ev.type) {
                  case 'message_start': {
                    // Start a new assistant response
                    currentAssistantId = nextMessageId();
                    pendingBlocks = [];
                    dispatch({ type: 'START_ASSISTANT_RESPONSE', id: currentAssistantId });
                    break;
                  }

                  case 'content_block_start': {
                    if (!currentAssistantId) break;
                    const cb = ev.content_block as Record<string, unknown> | undefined;
                    if (!cb) break;
                    const tuiBlock = mapCoreBlockToTui(cb as Parameters<typeof mapCoreBlockToTui>[0]);
                    pendingBlocks = [...pendingBlocks, tuiBlock];
                    // Record tool_use_id → toolName for inline result filtering
                    if (tuiBlock.type === 'tool_use' && tuiBlock.toolId) {
                      toolNameMapRef.current.set(tuiBlock.toolId, tuiBlock.toolName);
                    }
                    dispatch({ type: 'START_BLOCK', messageId: currentAssistantId, block: tuiBlock });
                    break;
                  }

                  case 'content_block_delta': {
                    if (!currentAssistantId) break;
                    const delta = ev.delta as Record<string, unknown> | undefined;
                    if (!delta) break;
                    let deltaType: BlockDeltaType | null = null;
                    let text = '';
                    if (delta.text) { deltaType = 'text'; text = delta.text as string; }
                    else if (delta.thinking) { deltaType = 'thinking'; text = delta.thinking as string; }
                    else if (delta.partial_json) { deltaType = 'json'; text = delta.partial_json as string; }
                    if (deltaType) {
                      pendingDeltasRef.current.push({ messageId: currentAssistantId, deltaType, text });
                      scheduleFlush();
                    }
                    break;
                  }

                  case 'content_block_stop':
                    if (currentAssistantId) {
                      flushDeltas();
                      dispatch({ type: 'STOP_BLOCK', messageId: currentAssistantId });
                    }
                    break;

                  case 'message_stop':
                    if (currentAssistantId) {
                      flushDeltas();
                      dispatch({ type: 'FINISH_ASSISTANT_RESPONSE', id: currentAssistantId });
                      // Track final token usage
                      const stopMsg = ev.message as Record<string, unknown> | undefined;
                      const stopUsage = stopMsg?.usage as Record<string, number> | undefined;
                      if (stopUsage) {
                        dispatch({
                          type: 'UPDATE_TOKEN_USAGE',
                          usage: {
                            inputTokens: stopUsage.input_tokens ?? 0,
                            outputTokens: stopUsage.output_tokens ?? 0,
                            cacheCreationInputTokens: stopUsage.cache_creation_input_tokens ?? 0,
                            cacheReadInputTokens: stopUsage.cache_read_input_tokens ?? 0,
                          },
                        });
                      }
                      currentAssistantId = null;
                    }
                    break;
                }
              }

              // ── Assistant message: tool_use results ────────
              if (msg.type === 'assistant' && msg.message) {
                // Tool-use blocks from the agent loop are rendered as
                // part of the assistant message that was already streamed.
                // If the assistant message contains tool_use blocks, they
                // were already handled by the stream events above.
                // No additional dispatch needed.
              }

              // ── User message: tool results ──────────────────
              if (msg.type === 'user' && msg.message) {
                const blocks = msg.message.content.map((b: Record<string, unknown>) => {
                  const tuiBlock = mapCoreBlockToTui(b as Parameters<typeof mapCoreBlockToTui>[0]);
                  // Enrich tool_result with toolName from the streamed tool_use blocks
                  if (tuiBlock.type === 'tool_result' && tuiBlock.toolId) {
                    const toolName = toolNameMapRef.current.get(tuiBlock.toolId);
                    if (toolName) {
                      (tuiBlock as ToolResultBlock).toolName = toolName;
                    }
                  }
                  return tuiBlock;
                });
                const toolResultMsg: Message = {
                  id: nextMessageId(),
                  role: 'user',
                  content: '',
                  blocks,
                  timestamp: Date.now(),
                };

                // Inject results into tool_use blocks for inline display
                for (const block of blocks) {
                  if (block.type === 'tool_result' && block.toolId) {
                    dispatch({
                      type: 'SET_TOOL_USE_RESULT',
                      toolId: block.toolId,
                      duration: block.duration,
                      result: {
                        content: block.content,
                        isError: block.isError,
                        metadata: block.metadata,
                      },
                    });
                  }
                }

                // Dispatch to TUI: exclude results shown inline by use renderers
                const tuiBlocks = blocks.filter(
                  (b) => b.type !== 'tool_result' || (b.toolName !== 'read' && b.toolName !== 'bash'),
                );
                if (tuiBlocks.length > 0) {
                  dispatch({
                    type: 'ADD_USER_MESSAGE',
                    message: { ...toolResultMsg, blocks: tuiBlocks },
                  });
                }
              }

              // ── Progress: update tool_use block state ──────────
              if (msg.type === 'system' && msg.subtype === 'progress') {
                const progress = (msg as Record<string, unknown>).data as {
                  toolName?: string; toolUseId?: string;
                  status?: string; message?: string;
                } | undefined;
                if (progress?.toolUseId) {
                  if (progress.status === 'running') {
                    dispatch({
                      type: 'UPDATE_BLOCK_STATE',
                      toolId: progress.toolUseId,
                      state: 'executing',
                    });
                  } else if (progress.status === 'started') {
                    // Keep in 'pending' state; the message describes what's happening
                  }
                }
              }
              break;
            }

            // ── Error event ──────────────────────────────────────
            case 'error': {
              const errData = event.data as { message?: string };
              dispatch({ type: 'SET_ERROR', error: errData?.message ?? String(event.data) });
              break;
            }

            // ── Permission required ──────────────────────────────
            case 'permission_required': {
              if (event.deferred) {
                const deferred = event.deferred;
                const approvalReq: ApprovalRequest = {
                  toolName: deferred.toolName,
                  command: deferred.command,
                  description: deferred.description,
                  toolUseId: deferred.toolUseId,
                };

                setPendingApproval({
                  toolName: deferred.toolName,
                  command: deferred.command,
                  description: deferred.description,
                  toolUseId: deferred.toolUseId,
                  deferred,
                });

                dispatch({ type: 'SHOW_APPROVAL', req: approvalReq });

                // Await user choice — the ApprovalPrompt component
                // calls deferred.resolve(true/false) when the user
                // picks an option.
                await deferred.promise;

                dispatch({ type: 'HIDE_APPROVAL' });
                setPendingApproval(null);
              }
              break;
            }

            // ── Done event ───────────────────────────────────────
            case 'done':
              flushDeltas();
              break;
          }
        }
      } catch (err) {
        flushDeltas();
        dispatch({ type: 'SET_ERROR', error: (err as Error).message });
      }
    },
    [engine, dispatch, flushDeltas, scheduleFlush],
  );

  return { runAgentTurn };
}
