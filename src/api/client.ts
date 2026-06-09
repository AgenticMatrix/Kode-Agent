import Anthropic from '@anthropic-ai/sdk';

import type { AppConfig, Message, ContentBlock, TextBlock, ThinkingBlock, ToolUseBlock, StreamCallbacks } from '../types.js';

/**
 * Build an Anthropic client from app config.
 */
export function createClient(config: AppConfig): Anthropic {
  return new Anthropic({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  });
}

/**
 * Extract plain text from a ContentBlock array for API conversion.
 * Concatenates text blocks and thinking blocks into a single string.
 */
function blocksToText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is TextBlock | ThinkingBlock =>
      b.type === 'text' || b.type === 'thinking')
    .map((b) => b.content)
    .join('');
}

/**
 * Convert internal Message array to Anthropic Messages API format.
 * User messages: concatenate all text blocks → string content.
 * Assistant messages: build content array from blocks (text + tool_use + tool_result).
 * System messages are extracted and returned separately.
 */
export function toAnthropicMessages(
  messages: Message[],
): { messages: Anthropic.MessageParam[]; system: string } {
  const anthropicMessages: Anthropic.MessageParam[] = [];
  const systemParts: string[] = [];

  for (const m of messages) {
    if (m.role === 'system') {
      const text = m.content || blocksToText(m.blocks);
      if (text.trim()) systemParts.push(text);
      continue;
    }

    const role = m.role as 'user' | 'assistant';

    // If the message has no blocks, treat content as plain text
    if (!m.blocks || m.blocks.length === 0) {
      if (m.content.trim()) {
        anthropicMessages.push({ role, content: m.content });
      }
      continue;
    }

    // Build Anthropic content from blocks
    const hasToolBlocks = m.blocks.some(
      (b) => b.type === 'tool_use' || b.type === 'tool_result',
    );

    if (!hasToolBlocks) {
      // Simple case: just text/thinking - use string content
      const text = blocksToText(m.blocks);
      if (text.trim()) {
        anthropicMessages.push({ role, content: text });
      }
    } else {
      // Complex case: convert blocks to Anthropic content block array
      const content: Anthropic.ContentBlockParam[] = [];
      for (const block of m.blocks) {
        if (block.type === 'text') {
          content.push({ type: 'text', text: block.content });
        } else if (block.type === 'thinking') {
          content.push({ type: 'text', text: block.content });
        } else if (block.type === 'tool_use') {
          content.push({
            type: 'tool_use',
            id: block.toolId,
            name: block.toolName,
            input: block.input as Record<string, unknown>,
          } as Anthropic.ToolUseBlockParam);
        } else if (block.type === 'tool_result') {
          content.push({
            type: 'tool_result',
            tool_use_id: block.toolId,
            content: block.content,
            is_error: block.isError,
          } as Anthropic.ToolResultBlockParam);
        }
        // Skip non-API blocks (boundaries, todos, subagents, etc.)
      }
      if (content.length > 0) {
        anthropicMessages.push({ role, content });
      }
    }
  }

  return {
    messages: anthropicMessages,
    system: systemParts.join('\n\n'),
  };
}

/** Legacy: kept for backward compatibility during transition. */
function toAnthropicMessagesLegacy(
  messages: Message[],
): Anthropic.MessageParam[] {
  return messages
    .filter((m) => m.role !== 'system' && m.content.trim().length > 0)
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
}

/**
 * Stream a chat completion with full ContentBlock event support.
 *
 * Callbacks:
 *  - onBlockStart(block)  — when a content_block_start is received
 *  - onBlockDelta(type, text) — when a delta arrives (text/thinking/json)
 *  - onBlockStop()        — when content_block_stop is received
 *  - onDone()             — stream completed successfully
 *  - onError(err)         — non-abort error
 *
 * Returns an AbortController for cancellation.
 */
export interface StreamOptions {
  /** Anthropic tool definitions to include in the request. */
  tools?: Anthropic.Tool[];
  /** System prompt override. */
  systemPrompt?: string;
}

export function streamChatBlocks(
  client: Anthropic,
  model: string,
  messages: Message[],
  callbacks: StreamCallbacks,
  options?: StreamOptions,
): AbortController {
  const abortController = new AbortController();

  const { messages: anthropicMessages, system } = toAnthropicMessages(messages);
  const legacySystem = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const systemPrompt = (options?.systemPrompt ?? system) || legacySystem || undefined;

  void (async () => {
    try {
      const stream = client.messages.stream(
        {
          model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: anthropicMessages,
          ...(options?.tools?.length ? { tools: options.tools } : {}),
        },
        { signal: abortController.signal },
      );

      // Track current tool_use accumulation for input_json_delta
      let pendingToolInput: Record<string, unknown> = {};

      for await (const event of stream) {
        switch (event.type) {
          case 'content_block_start': {
            const cb = event.content_block;
            pendingToolInput = {};

            if (cb.type === 'text') {
              callbacks.onBlockStart({
                type: 'text',
                content: '',
              } satisfies TextBlock);
            } else if (cb.type === 'thinking') {
              callbacks.onBlockStart({
                type: 'thinking',
                content: '',
              } satisfies ThinkingBlock);
            } else if (cb.type === 'tool_use') {
              // Some providers (DeepSeek) send the full input in content_block_start.
              // Spread the input directly so keys like `command` are immediately accessible
              // for rendering. Keep _partial for delta accumulation (standard Anthropic flow).
              const initialInput = (cb as { input?: object }).input as Record<string, unknown> | undefined;
              const hasInitialInput = initialInput && Object.keys(initialInput).length > 0;
              callbacks.onBlockStart({
                type: 'tool_use',
                toolName: cb.name,
                toolId: cb.id,
                input: hasInitialInput
                  ? { ...initialInput, _partial: JSON.stringify(initialInput) }
                  : {},
                state: 'executing',
                riskLevel: cb.name === 'bash' || cb.name === 'write' || cb.name === 'edit'
                  ? 'mutation' : 'safe',
              } satisfies ToolUseBlock);
            }
            break;
          }

          case 'content_block_delta': {
            const delta = event.delta;
            if (delta.type === 'text_delta') {
              callbacks.onBlockDelta('text', delta.text);
            } else if (delta.type === 'thinking_delta') {
              callbacks.onBlockDelta('thinking', delta.thinking);
            } else if (delta.type === 'input_json_delta') {
              callbacks.onBlockDelta('json', delta.partial_json);
            }
            break;
          }

          case 'content_block_stop':
            callbacks.onBlockStop();
            break;

          case 'message_stop':
            // message_stop signals the end of the response stream
            callbacks.onDone();
            break;
        }
      }

      // If the stream ended without message_stop (edge case), still signal done
      callbacks.onDone();
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return; // Silent abort
      }
      callbacks.onError(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  })();

  return abortController;
}

/**
 * Legacy streaming function — kept for backward compatibility.
 * Uses the new streamChatBlocks internally but adapts to old callback style.
 */
export function streamChat(
  client: Anthropic,
  model: string,
  messages: Message[],
  onDelta: (text: string) => void,
  onThinkingDelta: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (error: Error) => void,
): AbortController {
  let fullText = '';

  return streamChatBlocks(client, model, messages, {
    onBlockStart: (_block) => {
      // Legacy mode doesn't care about block boundaries
    },
    onBlockDelta: (deltaType, text) => {
      if (deltaType === 'text') {
        fullText += text;
        onDelta(text);
      } else if (deltaType === 'thinking') {
        onThinkingDelta(text);
      }
      // json deltas are ignored in legacy mode
    },
    onBlockStop: () => {
      // Legacy mode doesn't care about block boundaries
    },
    onDone: () => {
      onDone(fullText);
    },
    onError,
  });
}
