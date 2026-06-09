import { useRef, useCallback } from 'react';
import type Anthropic from '@anthropic-ai/sdk';

import type {
  Message, ContentBlock, ToolUseBlock, ToolResultBlock, ChatAction,
} from '../../types.js';
import { createClient, streamChatBlocks } from '../../api/client.js';
import { executeTool, getAnthropicTools } from '../../tools/registry.js';
import { nextMessageId } from './useChatReducer.js';

export interface AgentLoopDeps {
  config: { baseUrl: string; apiKey: string; model: string };
  /** Snapshot of messages before the turn starts. */
  getMessagesSnapshot: () => Message[];
  dispatch: React.Dispatch<ChatAction>;
}

/**
 * Hook that provides the agent turn execution loop.
 *
 * Flow:
 *   1. Send user message + tool definitions to API
 *   2. Stream response → accumulate blocks via dispatch
 *   3. On done: check for tool_use blocks → execute → add tool_result → loop
 *   4. Max 10 tool turns per user message to prevent infinite loops.
 */
export function useAgentLoop({ config, getMessagesSnapshot, dispatch }: AgentLoopDeps) {
  const clientRef = useRef(createClient(config));
  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);
  const streamBlocksRef = useRef<ContentBlock[]>([]);

  /** Stream one API call and return true on success, false on error. */
  const streamOneTurn = useCallback(
    async (apiMessages: Message[], assistantId: number): Promise<boolean> => {
      return new Promise<boolean>((resolve) => {
        dispatch({ type: 'START_ASSISTANT_RESPONSE', id: assistantId });

        abortRef.current = streamChatBlocks(
          clientRef.current,
          config.model,
          apiMessages,
          {
            onBlockStart: (block) => {
              streamBlocksRef.current = [...streamBlocksRef.current, block];
              dispatch({ type: 'START_BLOCK', messageId: assistantId, block });
            },
            onBlockDelta: (deltaType, blockDelta) => {
              // Accumulate JSON deltas into the ref for tool execution
              if (deltaType === 'json') {
                const blocks = streamBlocksRef.current;
                const lastIdx = blocks.length - 1;
                const last = blocks[lastIdx];
                if (last?.type === 'tool_use') {
                  const prev = (last.input as Record<string, unknown>)._partial as string ?? '';
                  blocks[lastIdx] = {
                    ...last,
                    input: { ...last.input, _partial: prev + blockDelta },
                  };
                  streamBlocksRef.current = blocks;
                }
              }
              dispatch({
                type: 'APPEND_BLOCK_DELTA',
                messageId: assistantId,
                deltaType,
                text: blockDelta,
              });
            },
            onBlockStop: () => {
              dispatch({ type: 'STOP_BLOCK', messageId: assistantId });
            },
            onDone: () => {
              dispatch({ type: 'FINISH_ASSISTANT_RESPONSE', id: assistantId });
              abortRef.current = null;
              resolve(true);
            },
            onError: (error) => {
              dispatch({ type: 'SET_ERROR', error: error.message });
              abortRef.current = null;
              resolve(false);
            },
          },
          { tools: getAnthropicTools() },
        );
      });
    },
    [config.model, dispatch],
  );

  /**
   * Run the full agent turn: user input → API → tool execution → tool_result → repeat.
   */
  const runAgentTurn = useCallback(
    async (text: string) => {
      if (streamingRef.current || text.trim().length === 0) return;

      const trimmed = text.trim();
      streamingRef.current = true;

      // ── Create user message ──────────────────────────────────
      const userMsg: Message = {
        id: nextMessageId(),
        role: 'user',
        content: trimmed,
        blocks: [{ type: 'text', content: trimmed } satisfies ContentBlock],
        timestamp: Date.now(),
      };
      dispatch({ type: 'ADD_USER_MESSAGE', message: userMsg });

      let apiMessages: Message[] = [...getMessagesSnapshot(), userMsg];

      // ── Agent loop ───────────────────────────────────────────
      const MAX_TOOL_TURNS = 10;
      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        const assistantId = nextMessageId();
        streamBlocksRef.current = [];

        // Small delay so React batches ADD_USER_MESSAGE render first
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            void streamOneTurn(apiMessages, assistantId).then((completed) => {
              resolve();
            });
          }, 0);
        });

        // ── Parse tool_use blocks ──────────────────────────────
        const rawToolUses = streamBlocksRef.current.filter(
          (b): b is ToolUseBlock => b.type === 'tool_use',
        );
        if (rawToolUses.length === 0) break;

        const toolUses: ToolUseBlock[] = rawToolUses.map((tu) => {
          const partial = (tu.input as Record<string, unknown>)._partial as string | undefined;
          let parsedInput: Record<string, unknown> = tu.input;
          if (partial) {
            try { parsedInput = JSON.parse(partial); } catch { parsedInput = { _raw: partial }; }
          }
          return { ...tu, input: parsedInput, state: 'done' as const };
        });

        // Update ref blocks with parsed input
        streamBlocksRef.current = streamBlocksRef.current.map((b) => {
          if (b.type !== 'tool_use') return b;
          const match = toolUses.find((tu) => tu.toolId === (b as ToolUseBlock).toolId);
          return match ?? b;
        });

        // ── Append assistant message to history ─────────────────
        const assistantMsg: Message = {
          id: assistantId,
          role: 'assistant',
          content: '',
          blocks: streamBlocksRef.current,
          timestamp: Date.now(),
        };
        apiMessages = [...apiMessages, assistantMsg];

        // ── Execute tools ───────────────────────────────────────
        const toolResultBlocks: ToolResultBlock[] = [];
        for (const tu of toolUses) {
          const result = await executeTool(tu.toolName, tu.input);
          const tr: ToolResultBlock = {
            type: 'tool_result',
            toolId: tu.toolId,
            toolName: tu.toolName,
            content: result.content,
            isError: result.isError,
            duration: result.duration,
            metadata: result.metadata,
          };
          toolResultBlocks.push(tr);

          // Inject result into the tool_use block for inline display
          dispatch({
            type: 'SET_TOOL_USE_RESULT',
            toolId: tu.toolId,
            duration: result.duration,
            result: { content: result.content, isError: result.isError, metadata: result.metadata },
          });
        }

        if (toolResultBlocks.length > 0) {
          const toolResultMsg: Message = {
            id: nextMessageId(),
            role: 'user',
            content: '',
            blocks: toolResultBlocks,
            timestamp: Date.now(),
          };
          apiMessages = [...apiMessages, toolResultMsg];

          // Dispatch to TUI: exclude results for tools that show them inline
          const tuiBlocks = toolResultBlocks.filter(
            (tr) => tr.toolName !== 'read' && tr.toolName !== 'bash',
          );
          if (tuiBlocks.length > 0) {
            dispatch({
              type: 'ADD_USER_MESSAGE',
              message: { ...toolResultMsg, blocks: tuiBlocks },
            });
          }
        }
      }

      streamingRef.current = false;
    },
    [getMessagesSnapshot, dispatch, streamOneTurn],
  );

  return { runAgentTurn, isStreaming: streamingRef };
}
