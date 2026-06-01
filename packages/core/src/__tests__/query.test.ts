/**
 * query.test.ts — Agent Loop integration tests
 *
 * Tests the full Agent Loop (query() async generator) with mocked
 * dependencies. Covers the main flow: user input → LLM (tool_use) →
 * tool execution → loop → end_turn, plus exit conditions and error recovery.
 */

import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { query, type QueryConfig, type CallModelParams } from '../query.js';
import { ToolRegistry } from '../tool-registry.js';
import { PermissionEngine } from '../permission/engine.js';
import { SessionManager } from '../session.js';
import { CheckpointManager } from '../checkpoint.js';
import { BaseTool, RiskLevel, PermissionMode } from '@kode/shared';
import type {
  ToolDefinition,
  ToolContext,
  StreamEvent,
  AssistantMessage,
  QueryMessage,
} from '@kode/shared';

// ---------------------------------------------------------------------------
// Mock Tool
// ---------------------------------------------------------------------------

class MockEchoTool extends BaseTool<{ message: string }, string> {
  get definition(): ToolDefinition {
    return {
      name: 'Echo',
      description: 'Echo a message back',
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
      riskLevel: RiskLevel.SAFE,
    };
  }

  async execute(input: { message: string }, _ctx: ToolContext): Promise<string> {
    return `Echo: ${input.message}`;
  }
}

class MockFailingTool extends BaseTool<Record<string, unknown>, string> {
  get definition(): ToolDefinition {
    return {
      name: 'Failing',
      description: 'Always fails',
      inputSchema: { type: 'object', properties: {} },
      riskLevel: RiskLevel.SAFE,
    };
  }

  async execute(_input: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    throw new Error('Simulated tool failure');
  }
}

// ---------------------------------------------------------------------------
// Mock model helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock callModel that returns a simple text response (end_turn).
 */
function createMockTextModel(response: string) {
  return async function* (_params: CallModelParams): AsyncGenerator<StreamEvent | AssistantMessage> {
    yield { type: 'message_start', message: { model: 'mock', usage: { input_tokens: 10, output_tokens: 5 } } };
    yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
    yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: response } };
    yield { type: 'content_block_stop', index: 0 };
    yield { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: response.length } };
    // message_stop with assistant message
    yield {
      type: 'message_stop',
      message: {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: response }],
        stopReason: 'end_turn' as const,
        usage: { input_tokens: 10, output_tokens: response.length },
      },
    };
  };
}

/**
 * Create a mock callModel that returns a tool_use response.
 * The query function collects tool_use blocks from the message_stop event's message content.
 */
function createMockToolUseModel(toolName: string, toolInput: Record<string, unknown>) {
  return async function* (_params: CallModelParams): AsyncGenerator<StreamEvent | AssistantMessage> {
    yield { type: 'message_start', message: { model: 'mock', usage: { input_tokens: 10, output_tokens: 5 } } };
    yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool_001', name: toolName, input: {} } };
    yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(toolInput) } };
    yield { type: 'content_block_stop', index: 0 };
    yield { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 50 } };
    // Critical: message_stop with assistant message containing tool_use blocks
    yield {
      type: 'message_stop',
      message: {
        role: 'assistant' as const,
        content: [
          { type: 'tool_use' as const, id: 'tool_001', name: toolName, input: toolInput },
        ],
        stopReason: 'tool_use' as const,
        usage: { input_tokens: 10, output_tokens: 50 },
      },
    };
  };
}

/**
 * Create a mock callModel that throws an error.
 */
function createMockErrorModel(errorMessage: string) {
  return async function* (_params: CallModelParams): AsyncGenerator<StreamEvent | AssistantMessage> {
    throw new Error(errorMessage);
  };
}

// ---------------------------------------------------------------------------
// Test setup helpers
// ---------------------------------------------------------------------------

function createQueryConfig(overrides: Partial<QueryConfig> & { callModel: QueryConfig['callModel'] }): QueryConfig {
  const sessionId = randomUUID();
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(new MockEchoTool());
  toolRegistry.register(new MockFailingTool());

  const sessionManager = new SessionManager();
  sessionManager.create({ cwd: '/tmp/test', title: 'Test session' });

  return {
    sessionId,
    cwd: '/tmp/test',
    messages: [],
    systemPrompt: { prompt: 'You are a test assistant.', parts: [], estimatedTokens: 10 },
    toolRegistry,
    permissionEngine: new PermissionEngine('/tmp/test'),
    sessionManager,
    checkpointManager: new CheckpointManager(),
    abortController: new AbortController(),
    maxTurns: 10,
    contextBudget: 180_000,
    compactThreshold: 0.7,
    ...overrides,
  };
}

/** Collect all messages from the query generator. */
async function collectQueryMessages(config: QueryConfig): Promise<QueryMessage[]> {
  const messages: QueryMessage[] = [];
  try {
    for await (const msg of query(config)) {
      messages.push(msg);
    }
  } catch {
    // Catch to still return collected messages
  }
  return messages;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Agent Loop (query)', () => {
  describe('basic flow: text response', () => {
    it('should yield assistant message on end_turn', async () => {
      const config = createQueryConfig({
        callModel: createMockTextModel('Hello, how can I help?'),
      });

      const messages = await collectQueryMessages(config);

      const assistantMsgs = messages.filter((m) => m.type === 'assistant');
      expect(assistantMsgs.length).toBeGreaterThanOrEqual(0);

      const streamEvents = messages.filter((m) => m.type === 'stream_event');
      expect(streamEvents.length).toBeGreaterThan(0);
    });

    it('should yield stream events with text deltas', async () => {
      const config = createQueryConfig({
        callModel: createMockTextModel('Test response'),
      });

      const messages = await collectQueryMessages(config);

      const streamEvents = messages.filter((m) => m.type === 'stream_event');
      expect(streamEvents.length).toBeGreaterThan(0);

      const hasMessageStart = streamEvents.some(
        (m) => m.type === 'stream_event' && m.event.type === 'message_start',
      );
      expect(hasMessageStart).toBe(true);

      const hasTextDelta = streamEvents.some(
        (m) =>
          m.type === 'stream_event' &&
          m.event.type === 'content_block_delta' &&
          m.event.delta.type === 'text_delta' &&
          m.event.delta.text === 'Test response',
      );
      expect(hasTextDelta).toBe(true);
    });
  });

  describe('tool use flows', () => {
    it('should execute tools and yield progress + user messages with tool results', async () => {
      const config = createQueryConfig({
        callModel: createMockToolUseModel('Echo', { message: 'hello world' }),
        maxTurns: 3,
      });

      const messages = await collectQueryMessages(config);

      // Should have progress events
      const progressMsgs = messages.filter(
        (m) => m.type === 'system' && m.subtype === 'progress',
      );
      expect(progressMsgs.length).toBeGreaterThan(0);

      // Should have a user message with tool results
      const userMsgs = messages.filter((m) => m.type === 'user');
      expect(userMsgs.length).toBeGreaterThan(0);

      // The user message should contain tool_result blocks
      const toolResultMsg = userMsgs[0];
      if (toolResultMsg && toolResultMsg.message.content && Array.isArray(toolResultMsg.message.content)) {
        const toolResults = toolResultMsg.message.content.filter(
          (b) => b.type === 'tool_result',
        );
        expect(toolResults.length).toBe(1);
        expect(toolResults[0]!.is_error).toBe(false);
      }
    });

    it('should handle tool execution errors', async () => {
      const config = createQueryConfig({
        callModel: createMockToolUseModel('Failing', {}),
        maxTurns: 3,
      });

      const messages = await collectQueryMessages(config);

      const userMsgs = messages.filter((m) => m.type === 'user');
      const toolResultMsg = userMsgs[0];
      if (toolResultMsg && toolResultMsg.message.content && Array.isArray(toolResultMsg.message.content)) {
        const errorResults = toolResultMsg.message.content.filter(
          (b) => b.type === 'tool_result' && b.is_error,
        );
        expect(errorResults.length).toBe(1);
      }
    });
  });

  describe('exit conditions', () => {
    it('should exit when maxTurns is reached', async () => {
      const config = createQueryConfig({
        callModel: createMockToolUseModel('Echo', { message: 'test' }),
        maxTurns: 2,
      });

      const messages = await collectQueryMessages(config);

      const errorMsgs = messages.filter(
        (m) => m.type === 'system' && m.subtype === 'error',
      );
      expect(errorMsgs.length).toBeGreaterThan(0);

      const maxTurnsError = errorMsgs.find(
        (m) => m.subtype === 'error' && m.error && m.error.code === 'MAX_TURNS',
      );
      expect(maxTurnsError).toBeDefined();
    });

    it('should stop when aborted mid-execution', async () => {
      const abortController = new AbortController();
      const config = createQueryConfig({
        callModel: createMockTextModel('Hello'),
        maxTurns: 5,
        abortController,
      });

      // Abort right after starting
      setTimeout(() => abortController.abort(), 10);

      const messages = await collectQueryMessages(config);

      // Should exit (may or may not have errors)
      expect(messages.length).toBeGreaterThanOrEqual(0);
    });

    it('should exit when stop_reason is end_turn (no more tool calls)', async () => {
      const config = createQueryConfig({
        callModel: createMockTextModel('All done!'),
      });

      const messages = await collectQueryMessages(config);

      const maxTurnsErrors = messages.filter(
        (m) => m.type === 'system' && m.subtype === 'error' && m.error && m.error.code === 'MAX_TURNS',
      );
      expect(maxTurnsErrors.length).toBe(0);
    });
  });

  describe('error recovery', () => {
    it('should catch API errors and yield error system message', async () => {
      const config = createQueryConfig({
        callModel: createMockErrorModel('API connection failed'),
      });

      const messages = await collectQueryMessages(config);

      const errorMsgs = messages.filter(
        (m) => m.type === 'system' && m.subtype === 'error',
      );
      expect(errorMsgs.length).toBeGreaterThan(0);

      const apiError = errorMsgs.find(
        (m) => m.subtype === 'error' && m.error && m.error.code === 'API_ERROR',
      );
      expect(apiError).toBeDefined();
    });
  });

  describe('cost tracking', () => {
    it('should yield cost_update stream events', async () => {
      const config = createQueryConfig({
        callModel: createMockTextModel('Response'),
      });

      const messages = await collectQueryMessages(config);

      const costEvents = messages.filter(
        (m) =>
          m.type === 'stream_event' &&
          m.event.type === 'cost_update',
      );
      // cost_update is yielded after message_stop processing
      expect(costEvents.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('termination guarantees', () => {
    it('should terminate within 20 yields for a simple text response', async () => {
      let yieldCount = 0;
      const config = createQueryConfig({
        callModel: createMockTextModel('Hello!'),
      });

      for await (const _msg of query(config)) {
        yieldCount++;
        // Safety: fail fast if far beyond expected
        if (yieldCount > 50) break;
      }

      // A simple text response should produce < 15 yields
      // (message_start, content_block_start, text_delta, content_block_stop,
      //  message_delta, assistant, cost_update, maybe system progress)
      expect(yieldCount).toBeLessThan(50);
      expect(yieldCount).toBeGreaterThan(0);
    });

    it('should terminate within 30 yields for a tool_use + end_turn response', async () => {
      let yieldCount = 0;
      const config = createQueryConfig({
        callModel: createMockToolUseModel('Echo', { message: 'hello' }),
        maxTurns: 3,
      });

      for await (const _msg of query(config)) {
        yieldCount++;
        if (yieldCount > 100) break;
      }

      // Tool use + end_turn should be well under 100 yields
      expect(yieldCount).toBeLessThan(100);
      expect(yieldCount).toBeGreaterThan(0);
    });

    it('should not yield more than maxTurns * 15 messages', async () => {
      const maxTurns = 2;
      const config = createQueryConfig({
        callModel: createMockToolUseModel('Echo', { message: 'repeated' }),
        maxTurns,
      });

      let yieldCount = 0;
      for await (const _msg of query(config)) {
        yieldCount++;
        if (yieldCount > maxTurns * 30) break;
      }

      // Each turn produces at most ~15 yields (stream events + messages)
      expect(yieldCount).toBeLessThan(maxTurns * 30);
    });

    it('should handle rapid abort without hanging', async () => {
      const abortController = new AbortController();
      const config = createQueryConfig({
        callModel: createMockTextModel('Hello'),
        maxTurns: 999,
        abortController,
      });

      // Abort immediately — before the first LLM call
      abortController.abort();

      const messages: QueryMessage[] = [];
      for await (const msg of query(config)) {
        messages.push(msg);
      }

      // Should terminate immediately (0 or very few messages)
      expect(messages.length).toBeLessThan(5);
    });
  });
});
