/**
 * OpenAI Compat Provider — OpenAI Chat Completions API via native fetch + SSE.
 *
 * Supports any OpenAI-compatible endpoint (OpenAI, Groq, OpenRouter, etc.)
 * Uses raw fetch + manual SSE parsing — no openai SDK dependency.
 */

import type { ProviderMessage, ProviderToolDefinition } from './types.js';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

import type {
  Provider,
  ProviderConfig,
  ProviderResponse,
  NormalizedContentBlock,
  ModelConfig,
  StreamEvent,
  Usage,
  ModelInfo,
} from './base.js';
import { withRetry, classifyError } from './retry.js';

// ---------------------------------------------------------------------------
// OpenAI API Types (minimal)
// ---------------------------------------------------------------------------

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAISSEChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index: number;
    delta?: {
      role?: string;
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.50, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  'deepseek-chat': { input: 0.14, output: 0.28 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  'groq-llama3-70b': { input: 0.59, output: 0.79 },
  'groq-mixtral-8x7b': { input: 0.24, output: 0.24 },
  default: { input: 1.0, output: 4.0 },
};

// ---------------------------------------------------------------------------
// OpenAI Compat Provider
// ---------------------------------------------------------------------------

export class OpenAICompatProvider implements Provider {
  protected abortController: AbortController | null = null;
  protected readonly config: ProviderConfig;
  protected readonly defaultBaseUrl: string;
  protected readonly providerName: string;
  protected readonly proxyAgent: ProxyAgent | undefined;

  constructor(
    config: ProviderConfig,
    providerName: string = 'openai',
    defaultBaseUrl: string = 'https://api.openai.com/v1',
  ) {
    this.config = config;
    this.providerName = providerName;
    this.defaultBaseUrl = defaultBaseUrl;
    this.proxyAgent = config.proxy ? new ProxyAgent({ uri: config.proxy }) : undefined;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  async stream(
    modelConfig: ModelConfig,
    system: string,
    messages: ProviderMessage[],
    tools: ProviderToolDefinition[],
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
        id: 'gpt-4o',
        name: 'GPT-4o',
        provider: this.providerName,
        contextWindow: 128_000,
        maxOutputTokens: 16384,
        supportsTools: true,
        supportsVision: true,
        pricing: { input: 2.50, output: 10.0 },
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        provider: this.providerName,
        contextWindow: 128_000,
        maxOutputTokens: 16384,
        supportsTools: true,
        supportsVision: true,
        pricing: { input: 0.15, output: 0.60 },
      },
    ];
  }

  // -----------------------------------------------------------------------
  // Extension Points (override in subclasses)
  // -----------------------------------------------------------------------

  protected buildRequestHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
    };
  }

  protected getPricingForModel(model: string): { input: number; output: number } {
    return OPENAI_PRICING[model] ?? OPENAI_PRICING.default!;
  }

  protected buildStreamUrl(baseUrl: string): string {
    return `${baseUrl}/chat/completions`;
  }

  // -----------------------------------------------------------------------
  // Internal Implementation
  // -----------------------------------------------------------------------

  private async _streamImpl(
    modelConfig: ModelConfig,
    system: string,
    messages: ProviderMessage[],
    tools: ProviderToolDefinition[],
    onEvent: (event: StreamEvent) => void,
  ): Promise<ProviderResponse> {
    const signal = this.abortController!.signal;
    const baseUrl = this.config.baseUrl ?? this.defaultBaseUrl;
    const url = this.buildStreamUrl(baseUrl);

    const openaiMessages = this.convertMessages(system, messages);
    const openaiTools = this.convertTools(tools);

    const requestBody: Record<string, unknown> = {
      model: modelConfig.model,
      messages: openaiMessages,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: modelConfig.maxTokens ?? 32768,
    };

    if (modelConfig.temperature !== undefined) {
      requestBody.temperature = modelConfig.temperature;
    }

    if (openaiTools.length > 0) {
      requestBody.tools = openaiTools;
      requestBody.tool_choice = 'auto';
    }

    // Streaming state
    let accumulatedText = '';
    const toolUseBuilders = new Map<number, {
      id: string;
      name: string;
      arguments: string;
    }>();
    const contentBlocks: NormalizedContentBlock[] = [];
    let finalStopReason = 'end_turn';
    let inputTokens = 0;
    let outputTokens = 0;
    let modelReported = modelConfig.model;
    const reasoningState = { active: false };

    try {
      const fetchInit: Record<string, unknown> = {
        method: 'POST',
        headers: this.buildRequestHeaders(),
        body: JSON.stringify(requestBody),
        signal,
      };
      if (this.proxyAgent) {
        fetchInit.dispatcher = this.proxyAgent;
      }
      const response = await undiciFetch(url, fetchInit as any);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        const error = new Error(`OpenAI HTTP ${response.status}: ${errorBody.slice(0, 500)}`);
        (error as unknown as Record<string, unknown>).status = response.status;
        throw error;
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      onEvent({
        type: 'message_start',
        model: modelConfig.model,
        usage: undefined,
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') continue;

          try {
            const chunk: OpenAISSEChunk = JSON.parse(dataStr);
            this.processSSEChunk(
              chunk, onEvent, contentBlocks, toolUseBuilders,
              { accumulated: accumulatedText }, reasoningState,
            );

            if (chunk.choices?.[0]?.finish_reason) {
              finalStopReason = chunk.choices[0].finish_reason;
            }

            if (chunk.choices?.[0]?.delta?.content) {
              accumulatedText += chunk.choices[0].delta.content;
            }

            if (chunk.model) modelReported = chunk.model;
            if (chunk.usage) {
              inputTokens = chunk.usage.prompt_tokens ?? 0;
              outputTokens = chunk.usage.completion_tokens ?? 0;
            }
          } catch { /* skip malformed chunks */ }
        }
      }

      // Process remaining buffer
      if (buffer.trim().startsWith('data: ') && buffer.trim().slice(6) !== '[DONE]') {
        try {
          const chunk: OpenAISSEChunk = JSON.parse(buffer.trim().slice(6));
          this.processSSEChunk(chunk, onEvent, contentBlocks, toolUseBuilders,
            { accumulated: accumulatedText }, reasoningState);
          if (chunk.choices?.[0]?.finish_reason) {
            finalStopReason = chunk.choices[0].finish_reason;
          }
          if (chunk.usage) {
            inputTokens = chunk.usage.prompt_tokens ?? 0;
            outputTokens = chunk.usage.completion_tokens ?? 0;
          }
        } catch { /* skip */ }
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

    const mappedStopReason = this.mapStopReason(finalStopReason);

    const pricing = this.getPricingForModel(modelConfig.model);
    const totalCost =
      (inputTokens / 1_000_000) * pricing.input +
      (outputTokens / 1_000_000) * pricing.output;

    const usage: Usage = {
      inputTokens,
      outputTokens,
      totalCost: Math.round(totalCost * 10000) / 10000,
    };

    onEvent({ type: 'message_stop', stopReason: mappedStopReason, usage });

    return { content: contentBlocks, stopReason: mappedStopReason, usage };
  }

  // -----------------------------------------------------------------------
  // SSE Chunk Processing
  // -----------------------------------------------------------------------

  private processSSEChunk(
    chunk: OpenAISSEChunk,
    onEvent: (event: StreamEvent) => void,
    contentBlocks: NormalizedContentBlock[],
    toolUseBuilders: Map<number, { id: string; name: string; arguments: string }>,
    state: { accumulated: string },
    reasoningState: { active: boolean },
  ): void {
    const choice = chunk.choices?.[0];
    if (!choice) return;

    const delta = choice.delta;
    if (!delta) return;

    // Reasoning content (DeepSeek reasoner)
    if (delta.reasoning_content) {
      const reasoning = delta.reasoning_content;
      if (!reasoningState.active) {
        reasoningState.active = true;
        onEvent({ type: 'thinking', thinking: reasoning, phase: 'start' });
      } else {
        onEvent({ type: 'thinking', thinking: reasoning, phase: 'delta' });
      }
    }

    // Text content
    if (delta.content) {
      if (reasoningState.active) {
        reasoningState.active = false;
        onEvent({ type: 'thinking', thinking: '', phase: 'end' });
      }
      onEvent({ type: 'text_delta', text: delta.content });
    }

    // Tool calls
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index;

        if (tc.id) {
          toolUseBuilders.set(idx, {
            id: tc.id,
            name: tc.function?.name ?? '',
            arguments: tc.function?.arguments ?? '',
          });
          onEvent({
            type: 'tool_use_start',
            id: tc.id,
            name: tc.function?.name ?? '',
            input: {},
          });
        }

        if (!tc.id && tc.function) {
          const existing = toolUseBuilders.get(idx);
          if (existing) {
            if (tc.function.name) existing.name = tc.function.name;
            if (tc.function.arguments) {
              existing.arguments += tc.function.arguments;
              onEvent({
                type: 'tool_use_delta',
                id: existing.id,
                partialJson: tc.function.arguments,
              });
            }
          }
        }
      }
    }

    // Finish reason
    if (choice.finish_reason) {
      if (reasoningState.active) {
        reasoningState.active = false;
        onEvent({ type: 'thinking', thinking: '', phase: 'end' });
      }

      for (const [idx, builder] of toolUseBuilders) {
        let parsedInput: Record<string, unknown> = {};
        try { parsedInput = JSON.parse(builder.arguments); } catch { /* partial */ }
        contentBlocks.push({
          type: 'tool_use',
          id: builder.id,
          name: builder.name,
          input: parsedInput,
        });
        onEvent({ type: 'tool_use_end', id: builder.id, input: parsedInput });
        toolUseBuilders.delete(idx);
      }

      if (state.accumulated && !contentBlocks.some(b => b.type === 'text' && b.text === state.accumulated)) {
        contentBlocks.push({ type: 'text', text: state.accumulated });
        state.accumulated = '';
      }
    }
  }

  // -----------------------------------------------------------------------
  // Message Conversion (Coder → OpenAI)
  // -----------------------------------------------------------------------

  private convertMessages(system: string, messages: ProviderMessage[]): OpenAIMessage[] {
    const result: OpenAIMessage[] = [];

    if (system) {
      result.push({ role: 'system', content: system });
    }

    for (const msg of messages) {
      if (msg.role === 'system') continue;

      if (typeof msg.content === 'string') {
        result.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
        continue;
      }

      const textBlocks: string[] = [];
      const toolCalls: OpenAIToolCall[] = [];
      const toolResults: Array<{ tool_call_id: string; content: string }> = [];

      for (const block of msg.content) {
        switch (block.type) {
          case 'text':
            if (block.text) textBlocks.push(block.text);
            break;

          case 'tool_use':
            if (block.id && block.name) {
              toolCalls.push({
                id: block.id,
                type: 'function',
                function: {
                  name: block.name,
                  arguments: JSON.stringify(block.input ?? {}),
                },
              });
            }
            break;

          case 'tool_result':
            if (block.tool_use_id) {
              const resultContent = typeof block.content === 'string'
                ? block.content
                : Array.isArray(block.content)
                  ? block.content.map((b) => ('text' in b ? b.text : '')).join('\n')
                  : '';
              toolResults.push({
                tool_call_id: block.tool_use_id,
                content: resultContent,
              });
            }
            break;

          case 'thinking':
          case 'image':
            break;
        }
      }

      if (toolCalls.length > 0) {
        result.push({
          role: 'assistant',
          content: textBlocks.length > 0 ? textBlocks.join('\n') : null,
          tool_calls: toolCalls,
        });

        for (const tr of toolResults) {
          result.push({
            role: 'tool',
            tool_call_id: tr.tool_call_id,
            content: tr.content,
          });
        }
      } else if (msg.role === 'assistant' && textBlocks.length > 0) {
        result.push({
          role: 'assistant',
          content: textBlocks.join('\n'),
        });
      } else if (msg.role === 'user') {
        result.push({
          role: 'user',
          content: textBlocks.join('\n') || '',
        });
      }
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // Tool Conversion
  // -----------------------------------------------------------------------

  private convertTools(tools: ProviderToolDefinition[]): OpenAITool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: (tool.inputSchema.properties as Record<string, unknown>) ?? {},
          required: tool.inputSchema.required ?? [],
          additionalProperties: false,
        },
      },
    }));
  }

  // -----------------------------------------------------------------------
  // Stop Reason Mapping
  // -----------------------------------------------------------------------

  private mapStopReason(openaiReason: string): string {
    switch (openaiReason) {
      case 'stop': return 'end_turn';
      case 'tool_calls': return 'tool_use';
      case 'length': return 'max_tokens';
      case 'function_call': return 'tool_use';
      default: return 'end_turn';
    }
  }
}
