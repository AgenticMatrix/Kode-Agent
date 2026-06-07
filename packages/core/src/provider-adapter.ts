/**
 * provider-adapter.ts — Bridge Provider.stream() → Agent Loop callModel
 *
 * Converts Provider's callback-based streaming to the AsyncGenerator pattern
 * expected by the Agent Loop's query() function.
 */

import type {
  AssistantMessage,
  ContentBlock,
  CompletionUsage,
  StreamEvent as SharedStreamEvent,
  StopReason,
} from '@coder/shared';
import type { JSONSchema } from '@coder/shared';
import { createAssistantMessage, RiskLevel } from '@coder/shared';
import type { CallModelParams } from './query.js';
import type { Provider, ProviderConfig, ProviderResponse, ThinkingConfig, ModelConfig } from '@coder/provider';
import type { StreamEvent as ProviderStreamEvent } from '@coder/provider';
import { AnthropicProvider } from '@coder/provider';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createCallModelFromProvider(
  provider: Provider,
  model: string,
  thinking?: ThinkingConfig,
  maxTokens?: number,
): (params: CallModelParams) => AsyncGenerator<SharedStreamEvent | AssistantMessage> {
  return async function* callModel(
    params: CallModelParams,
  ): AsyncGenerator<SharedStreamEvent | AssistantMessage> {
    const { system, messages, tools, signal } = params;

    const toolDefinitions = (tools as Array<{
      name: string; description: string; input_schema: Record<string, unknown>;
    }>).map((t) => ({
      name: t.name, description: t.description,
      inputSchema: t.input_schema as JSONSchema, riskLevel: RiskLevel.MUTATION,
    }));

    // Linked-list queue — O(1) enqueue and dequeue, avoids Array.shift() overhead.
    // Each node holds one stream event; head/tail track the FIFO boundaries.
    interface QueueNode { event: SharedStreamEvent; next: QueueNode | null; }
    let head: QueueNode | null = null;
    let tail: QueueNode | null = null;
    let queueSize = 0;
    const enqueue = (event: SharedStreamEvent): void => {
      const node: QueueNode = { event, next: null };
      if (tail) { tail.next = node; } else { head = node; }
      tail = node;
      queueSize++;
    };
    const dequeue = (): SharedStreamEvent | null => {
      if (!head) return null;
      const event = head.event;
      head = head.next;
      if (!head) tail = null;
      queueSize--;
      return event;
    };
    let done = false;
    let error: Error | null = null;
    let drain: (() => void) | null = null;
    const converter = createConverter();

    const onEvent = (event: ProviderStreamEvent): void => {
      const out = converter.convert(event);
      if (out) { enqueue(out); if (drain) { const d = drain; drain = null; d(); } }
    };

    // Build ModelConfig with optional thinking configuration and maxTokens
    const modelConfig: ModelConfig = { model };
    if (maxTokens !== undefined) {
      modelConfig.maxTokens = maxTokens;
    }
    if (thinking && thinking.mode !== 'disabled') {
      modelConfig.thinking = thinking;
    }

    let response: ProviderResponse;
    const streamPromise = provider
      .stream(modelConfig, system, messages, toolDefinitions, onEvent)
      .then((r) => { response = r; done = true; return r; })
      .catch((e: unknown) => { error = e instanceof Error ? e : new Error(String(e)); done = true; })
      .finally(() => { if (drain) { const d = drain; drain = null; d(); } });

    const onAbort = (): void => { provider.abort(); };
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      while (!done || queueSize > 0) {
        if (queueSize > 0) { yield dequeue()!; }
        else if (!done) { await new Promise<void>((r) => { drain = r; }); }
      }
      if (error) throw error;
      await streamPromise;
      // Drain any stranded pending events before building the final message.
      // Without this, the last text_delta content_block_delta stays stuck in
      // the converter's pending queue and never reaches the consumer.
      while (true) {
        const flushed = converter.flush();
        if (flushed.length === 0) break;
        for (const ev of flushed) yield ev;
      }
      if (response!) { yield converter.build(response, model); }
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  };
}

export function createCallModelFromConfig(
  config: ProviderConfig,
  model: string,
): (params: CallModelParams) => AsyncGenerator<SharedStreamEvent | AssistantMessage> {
  return createCallModelFromProvider(new AnthropicProvider(config), model);
}

export function resetAdapterState(): void { /* no-op: state is closure-local */ }

// ---------------------------------------------------------------------------
// Event Converter
// ---------------------------------------------------------------------------

interface Converter {
  convert(event: ProviderStreamEvent): SharedStreamEvent | null;
  build(response: ProviderResponse, model: string): AssistantMessage;
  /** Drain any stranded pending events (must call before build() at end of stream) */
  flush(): SharedStreamEvent[];
}

function createConverter(): Converter {
  let blockIdx = 0;
  let blockType: 'text' | 'tool_use' | 'thinking' | null = null;
  let lastModel = 'unknown';
  let lastUsage: CompletionUsage = { input_tokens: 0, output_tokens: 0 };
  const pending: SharedStreamEvent[] = [];

  return {
    convert(event: ProviderStreamEvent): SharedStreamEvent | null {
      switch (event.type) {
        case 'message_start':
          lastModel = event.model;
          lastUsage = {
            input_tokens: event.usage?.inputTokens ?? 0,
            output_tokens: event.usage?.outputTokens ?? 0,
            cache_creation_input_tokens: event.usage?.cacheCreationInputTokens,
            cache_read_input_tokens: event.usage?.cacheReadInputTokens,
          };
          return { type: 'message_start', message: { model: event.model, usage: lastUsage } };

        case 'text_delta': {
          if (blockType !== 'text') {
            // Transition from tool_use or thinking → text: close the current block.
            // (text → text: no-op, blockType stays 'text')
            if (blockType === 'tool_use' || blockType === 'thinking') {
              pending.push({ type: 'content_block_stop', index: blockIdx });
              blockIdx++;
            }
            blockType = 'text';
            pending.push({ type: 'content_block_start', index: blockIdx, content_block: { type: 'text', text: '' } });
          }
          if (pending.length > 0) {
            pending.push({ type: 'content_block_delta', index: blockIdx, delta: { type: 'text_delta', text: event.text } });
            return pending.shift()!;
          }
          return { type: 'content_block_delta', index: blockIdx, delta: { type: 'text_delta', text: event.text } };
        }

        case 'tool_use_start':
          // Transition from text or thinking → tool_use: close the current block first.
          if (blockType === 'text' || blockType === 'thinking') {
            pending.push({ type: 'content_block_stop', index: blockIdx });
          }
          if (blockType !== null) blockIdx++;
          blockType = 'tool_use';
          return { type: 'content_block_start', index: blockIdx, content_block: { type: 'tool_use', id: event.id, name: event.name, input: event.input ?? {} } };

        case 'tool_use_delta':
          return { type: 'content_block_delta', index: blockIdx, delta: { type: 'input_json_delta', partial_json: event.partialJson } };

        case 'tool_use_end':
          blockType = null; // Reset so next text_delta won't double-close the tool_use block
          return { type: 'content_block_stop', index: blockIdx };

        // ── Thinking events (DeepSeek R1, Claude extended thinking) ────
        // DeepSeek produces thinking blocks (internal reasoning) BEFORE text
        // blocks. The thinking phase can last 10-60+ seconds. Without this
        // handler, ALL thinking events hit `default: return null`, dropping
        // them — the TUI receives ZERO events during the thinking phase,
        // making the user think the app is stuck.
        case 'thinking': {
          switch (event.phase) {
            case 'start': {
              // Close previous block (text or tool_use) before starting thinking
              if (blockType === 'text' || blockType === 'tool_use') {
                pending.push({ type: 'content_block_stop', index: blockIdx });
              }
              if (blockType !== null) blockIdx++;
              blockType = 'thinking';
              return {
                type: 'content_block_start',
                index: blockIdx,
                content_block: {
                  type: 'thinking',
                  thinking: event.thinking,
                  signature: event.signature,
                } as import('@coder/shared').ContentBlock,
              };
            }
            case 'delta':
              return {
                type: 'content_block_delta',
                index: blockIdx,
                delta: { type: 'thinking_delta' as const, thinking: event.thinking },
              };
            case 'end':
              blockType = null;
              return { type: 'content_block_stop', index: blockIdx };
          }
          return null;
        }

        case 'message_stop':
          lastUsage = {
            input_tokens: event.usage?.inputTokens ?? lastUsage.input_tokens,
            output_tokens: event.usage?.outputTokens ?? lastUsage.output_tokens,
            cache_creation_input_tokens: event.usage?.cacheCreationInputTokens ?? lastUsage.cache_creation_input_tokens,
            cache_read_input_tokens: event.usage?.cacheReadInputTokens ?? lastUsage.cache_read_input_tokens,
            totalCost: event.usage?.totalCost,
          };
          return { type: 'message_delta', delta: { stop_reason: (event.stopReason as StopReason) ?? 'end_turn', usage: lastUsage } };

        default: return null;
      }
    },

    flush(): SharedStreamEvent[] {
      const drained = pending.splice(0);
      return drained;
    },

    build(response: ProviderResponse, model: string): AssistantMessage {
      const blocks: ContentBlock[] = response.content.map((b) => {
        switch (b.type) {
          case 'text': return { type: 'text', text: b.text };
          case 'tool_use': return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
          case 'thinking': return { type: 'thinking', thinking: b.thinking, signature: b.signature };
        }
      });
      return createAssistantMessage(blocks, (response.stopReason as StopReason) ?? 'end_turn', {
        input_tokens: response.usage.inputTokens, output_tokens: response.usage.outputTokens,
        cache_creation_input_tokens: response.usage.cacheCreationInputTokens,
        cache_read_input_tokens: response.usage.cacheReadInputTokens,
        totalCost: response.usage.totalCost,
      }, model);
    },
  };
}
