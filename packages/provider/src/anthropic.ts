/**
 * Anthropic Provider — Anthropic Messages API via @anthropic-ai/sdk.
 *
 * Handles streaming (SSE), extended thinking, tool use, cost calculation,
 * and cancellation via AbortController.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ContentBlockParam, TextBlockParam, Tool } from '@anthropic-ai/sdk/resources/messages.mjs';

import type { Message } from '@coder/shared';
import type { ToolDefinition } from '@coder/shared';

import type {
  Provider,
  ProviderConfig,
  ProviderResponse,
  ProviderContentBlock,
  ModelConfig,
  StreamEvent,
  Usage,
  ModelInfo,
} from './base.js';
import { calculateCost } from './base.js';
import { withRetry, classifyError } from './retry.js';

// ---------------------------------------------------------------------------
// Anthropic Provider Implementation
// ---------------------------------------------------------------------------

export class AnthropicProvider implements Provider {
  private client: Anthropic;
  private abortController: AbortController | null = null;
  private readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeout ?? 300_000,
      maxRetries: 0, // We handle retries ourselves in withRetry()
    });
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  async stream(
    modelConfig: ModelConfig,
    system: string,
    messages: Message[],
    tools: ToolDefinition[],
    onEvent: (event: StreamEvent) => void,
  ): Promise<ProviderResponse> {
    this.abortController = new AbortController();

    return withRetry(
      () => this._streamImpl(modelConfig, system, messages, tools, onEvent),
      {
        maxRetries: this.config.maxRetries ?? 3,
        onRetry: (attempt, error, delayMs) => {
          onEvent({
            type: 'error',
            code: `RETRY_ATTEMPT_${attempt}`,
            message: `Retrying after ${error.class} (attempt ${attempt}/${this.config.maxRetries ?? 3}, ${Math.round(delayMs)}ms)`,
            retryable: true,
          });
        },
      },
    );
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        provider: 'anthropic',
        contextWindow: 200_000,
        maxOutputTokens: 8192,
        supportsTools: true,
        supportsVision: true,
        pricing: { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.30 },
      },
      {
        id: 'claude-opus-4-5',
        name: 'Claude Opus 4.5',
        provider: 'anthropic',
        contextWindow: 200_000,
        maxOutputTokens: 8192,
        supportsTools: true,
        supportsVision: true,
        pricing: { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.50 },
      },
      {
        id: 'claude-haiku-4-5',
        name: 'Claude Haiku 4.5',
        provider: 'anthropic',
        contextWindow: 200_000,
        maxOutputTokens: 8192,
        supportsTools: true,
        supportsVision: true,
        pricing: { input: 0.80, output: 4.0, cacheWrite: 1.0, cacheRead: 0.08 },
      },
    ];
  }

  // -----------------------------------------------------------------------
  // Internal Implementation
  // -----------------------------------------------------------------------

  private async _streamImpl(
    modelConfig: ModelConfig,
    system: string,
    messages: Message[],
    tools: ToolDefinition[],
    onEvent: (event: StreamEvent) => void,
  ): Promise<ProviderResponse> {
    const signal = this.abortController!.signal;

    // Convert Coder tool definitions to Anthropic format.
    // Anthropic SDK requires input_schema to have at minimum { type: 'object' }.
    const anthropicTools: Tool[] | undefined = tools.length > 0
      ? tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: {
            type: 'object' as const,
            ...(tool.inputSchema as Record<string, unknown>),
          },
        }))
      : undefined;

    const apiMessages = this.normalizeMessages(messages);

    // Build and launch the stream
    const stream = this.client.messages.stream({
      model: modelConfig.model,
      system: system || undefined,
      messages: apiMessages as MessageParam[],
      max_tokens: modelConfig.maxTokens ?? 8192,
      temperature: modelConfig.temperature,
      tools: anthropicTools as Anthropic.MessageCreateParams['tools'],
      thinking: this.buildThinkingConfig(modelConfig),
    }, { signal });

    // Streaming state
    let accumulatedText = '';
    let currentToolUseId: string | null = null;
    let currentToolName: string | null = null;
    let currentToolInput = '';
    let currentThinking = '';
    let currentSignature: string | undefined;
    const contentBlocks: ProviderContentBlock[] = [];
    let finalStopReason = 'end_turn';
    let outputTokens = 0;
    let cacheCreationInputTokens = 0;
    let cacheReadInputTokens = 0;

    try {
      for await (const event of stream) {
        switch (event.type) {
          case 'message_start': {
            const msg = event.message;
            onEvent({
              type: 'message_start',
              model: msg.model,
              usage: msg.usage ? {
                inputTokens: msg.usage.input_tokens,
                outputTokens: msg.usage.output_tokens,
                cacheCreationInputTokens: msg.usage.cache_creation_input_tokens ?? 0,
                cacheReadInputTokens: msg.usage.cache_read_input_tokens ?? 0,
              } : undefined,
            });
            if (msg.usage) {
              cacheCreationInputTokens = msg.usage.cache_creation_input_tokens ?? 0;
              cacheReadInputTokens = msg.usage.cache_read_input_tokens ?? 0;
            }
            break;
          }

          case 'content_block_start': {
            const block = event.content_block;
            if (block.type === 'text') {
              accumulatedText = '';
            } else if (block.type === 'tool_use') {
              currentToolUseId = block.id;
              currentToolName = block.name;
              currentToolInput = '';
              onEvent({
                type: 'tool_use_start',
                id: block.id,
                name: block.name,
                input: (block.input ?? {}) as Record<string, unknown>,
              });
            } else if (block.type === 'thinking') {
              currentThinking = block.thinking;
              currentSignature = block.signature ?? undefined;
              onEvent({
                type: 'thinking',
                thinking: block.thinking,
                phase: 'start',
                signature: block.signature ?? undefined,
              });
            }
            break;
          }

          case 'content_block_delta': {
            const delta = event.delta;
            if (delta.type === 'text_delta') {
              accumulatedText += delta.text;
              onEvent({ type: 'text_delta', text: delta.text });
            } else if (delta.type === 'input_json_delta') {
              currentToolInput += delta.partial_json;
              onEvent({
                type: 'tool_use_delta',
                id: currentToolUseId!,
                partialJson: delta.partial_json,
              });
            } else if (delta.type === 'thinking_delta') {
              currentThinking += delta.thinking;
              onEvent({ type: 'thinking', thinking: delta.thinking, phase: 'delta' });
            } else if (delta.type === 'signature_delta') {
              currentSignature = delta.signature;
              onEvent({ type: 'thinking', thinking: '', phase: 'delta', signature: delta.signature });
            }
            break;
          }

          case 'content_block_stop': {
            if (currentToolUseId && currentToolInput) {
              let parsedInput: Record<string, unknown> = {};
              try { parsedInput = JSON.parse(currentToolInput); } catch { /* use {} */ }
              contentBlocks.push({
                type: 'tool_use',
                id: currentToolUseId,
                name: currentToolName ?? 'unknown',
                input: parsedInput,
              });
              onEvent({ type: 'tool_use_end', id: currentToolUseId, input: parsedInput });
              currentToolUseId = null;
              currentToolName = null;
              currentToolInput = '';
            } else if (accumulatedText) {
              contentBlocks.push({ type: 'text', text: accumulatedText });
              accumulatedText = '';
            } else if (currentThinking) {
              contentBlocks.push({
                type: 'thinking',
                thinking: currentThinking,
                signature: currentSignature,
              });
              onEvent({ type: 'thinking', thinking: '', phase: 'end', signature: currentSignature });
              currentThinking = '';
              currentSignature = undefined;
            }
            break;
          }

          case 'message_delta': {
            const delta = event.delta;
            if (delta.stop_reason) finalStopReason = delta.stop_reason as string;
            if (event.usage) outputTokens = event.usage.output_tokens;
            break;
          }

          case 'message_stop': {
            // Final usage available on stream.currentMessage after stream ends
            break;
          }
        }
      }
    } catch (error: unknown) {
      if (signal.aborted) {
        onEvent({ type: 'error', code: 'ABORTED', message: 'Request was aborted', retryable: false });
        throw new Error('Request aborted');
      }
      const classified = classifyError(error);
      onEvent({
        type: 'error',
        code: classified.class.toUpperCase(),
        message: classified.error.message,
        retryable: classified.retryable,
        raw: error,
      });
      throw error;
    } finally {
      this.abortController = null;
    }

    // Build final response from accumulated stream state
    const finalMessage = stream.currentMessage;
    const inputTokens = finalMessage?.usage?.input_tokens ?? 0;
    const finalOutputTokens = finalMessage?.usage?.output_tokens ?? outputTokens;
    const totalCost = calculateCost(
      modelConfig.model, inputTokens, finalOutputTokens,
      cacheCreationInputTokens, cacheReadInputTokens,
    );

    const usage: Usage = {
      inputTokens,
      outputTokens: finalOutputTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
      totalCost,
    };

    onEvent({ type: 'message_stop', stopReason: finalStopReason, usage });

    return { content: contentBlocks, stopReason: finalStopReason, usage };
  }

  // -----------------------------------------------------------------------
  // Message Normalization
  // -----------------------------------------------------------------------

  private normalizeMessages(messages: Message[]): MessageParam[] {
    return messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m): MessageParam => {
        if (typeof m.content === 'string') {
          return { role: m.role as 'user' | 'assistant', content: m.content };
        }

        const content = m.content
          .map((block): ContentBlockParam | null => {
            switch (block.type) {
              case 'text':
                return { type: 'text' as const, text: block.text ?? '' };

              case 'tool_use':
                return {
                  type: 'tool_use' as const,
                  id: block.id ?? '',
                  name: block.name ?? '',
                  input: (block.input ?? {}) as Record<string, unknown>,
                };

              case 'tool_result': {
                let resultContent: string | TextBlockParam[];
                if (typeof block.content === 'string') {
                  resultContent = block.content;
                } else if (Array.isArray(block.content)) {
                  resultContent = block.content.map((b) => ({
                    type: 'text' as const,
                    text: 'text' in b ? (b.text ?? '') : '',
                  }));
                } else {
                  resultContent = '';
                }
                return {
                  type: 'tool_result' as const,
                  tool_use_id: block.tool_use_id ?? '',
                  content: resultContent,
                  is_error: block.is_error,
                };
              }

              case 'thinking':
                return {
                  type: 'thinking' as const,
                  thinking: block.thinking ?? '',
                  signature: block.signature ?? '',
                };

              case 'image': {
                if (!block.source) return null;
                if (block.source.type === 'base64') {
                  return {
                    type: 'image' as const,
                    source: {
                      type: 'base64' as const,
                      media_type: block.source.media_type as 'image/jpeg',
                      data: block.source.data!,
                    },
                  };
                }
                return {
                  type: 'image' as const,
                  source: {
                    type: 'url' as const,
                    url: block.source.url!,
                  },
                };
              }

              default:
                return null;
            }
          })
          .filter((block): block is ContentBlockParam => block !== null);

        return { role: m.role as 'user' | 'assistant', content };
      });
  }

  // -----------------------------------------------------------------------
  // Thinking Configuration
  // -----------------------------------------------------------------------

  private buildThinkingConfig(
    modelConfig: ModelConfig,
  ): Anthropic.MessageCreateParams['thinking'] {
    if (!modelConfig.thinking || modelConfig.thinking.mode === 'disabled') {
      return undefined;
    }
    // 'enabled' is the correct thinking type for Anthropic.
    // 'adaptive' maps to 'enabled' with a budget.
    return {
      type: 'enabled',
      budget_tokens: modelConfig.thinking.budgetTokens,
    };
  }
}
