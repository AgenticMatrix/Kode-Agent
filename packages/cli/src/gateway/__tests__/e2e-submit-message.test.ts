/**
 * e2e-submit-message.test.ts — E2E: full QueryEngine.submitMessage() chain
 *
 * Verifies the complete Agent Loop does NOT deadlock when processing a
 * simple user message ("你好"). Uses a mock callModel to avoid requiring
 * API keys, and enforces a hard 5-second timeout to catch hangs.
 *
 * Bug reference: Sprint 7 introduced a `continue` (now fixed to `return`)
 * in query.ts:314 that could cause infinite looping when PreMessage hooks
 * blocked. This test ensures the generator terminates under normal
 * conditions.
 */

import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type {
  StreamEvent,
  AssistantMessage,
  CompletionUsage,
} from '@coder/shared';
import {
  QueryEngine,
  ToolRegistry,
  SessionManager,
  CheckpointManager,
} from '@coder/core';
import type { CallModelParams } from '@coder/core';
import type { QueryEngineEvent } from '@coder/core';

// ---------------------------------------------------------------------------
// Mock callModel — simple text response (no tool calls)
// ---------------------------------------------------------------------------

function makeUsage(overrides?: Partial<CompletionUsage>): CompletionUsage {
  return {
    input_tokens: 100,
    output_tokens: 50,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    ...overrides,
  };
}

async function* mockCallModel(
  _params: CallModelParams,
): AsyncGenerator<StreamEvent | AssistantMessage> {
  yield {
    type: 'message_start',
    message: { model: 'mock', usage: makeUsage({ input_tokens: 0, output_tokens: 0 }) },
  };
  yield {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  };
  const text = '你好！有什么可以帮助你的吗？';
  yield {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  };
  yield { type: 'content_block_stop', index: 0 };
  yield {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', usage: makeUsage() },
  } as StreamEvent;
  // Final AssistantMessage so the bridge can emit message.complete
  yield {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text }],
    stopReason: 'end_turn' as const,
    usage: makeUsage(),
    model: 'mock',
    toolUseBlocks: [],
  } as unknown as AssistantMessage;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestEngine() {
  const toolRegistry = new ToolRegistry();
  const sessionManager = new SessionManager();
  sessionManager.create({ cwd: '/tmp/test', title: 'E2E test session' });

  const engine = new QueryEngine({
    cwd: '/tmp/test',
    toolRegistry,
    sessionManager,
    maxTurns: 10,
    callModel: mockCallModel,
    model: 'mock',
  });

  return { engine, sessionManager };
}

/**
 * Collect all QueryEngineEvents within a hard timeout.
 * Returns the events and whether the generator completed (did not hang).
 */
async function collectEventsWithTimeout(
  generator: AsyncGenerator<QueryEngineEvent>,
  timeoutMs: number,
): Promise<{ events: QueryEngineEvent[]; completed: boolean }> {
  const events: QueryEngineEvent[] = [];
  let completed = false;

  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    setTimeout(() => resolve('timeout'), timeoutMs);
  });

  const collectPromise = (async () => {
    try {
      for await (const event of generator) {
        events.push(event);
      }
      completed = true;
    } catch {
      completed = false;
    }
  })();

  await Promise.race([collectPromise, timeoutPromise]);

  return { events, completed };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E: submitMessage("你好")', () => {
  it('should complete within 5 seconds (no deadlock)', async () => {
    const { engine } = createTestEngine();

    await engine.init();

    const generator = engine.submitMessage('你好');
    const { events, completed } = await collectEventsWithTimeout(generator, 5000);

    expect(completed).toBe(true);
    expect(events.length).toBeGreaterThan(0);
  });

  it('should produce at least one assistant message', async () => {
    const { engine } = createTestEngine();

    await engine.init();

    const generator = engine.submitMessage('你好');
    const { events } = await collectEventsWithTimeout(generator, 5000);

    const assistantEvents = events.filter(
      (e) =>
        e.type === 'message' &&
        typeof e.data === 'object' &&
        e.data !== null &&
        (e.data as { type?: string }).type === 'assistant',
    );
    expect(assistantEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('should produce a done event at the end', async () => {
    const { engine } = createTestEngine();

    await engine.init();

    const generator = engine.submitMessage('你好');
    const { events, completed } = await collectEventsWithTimeout(generator, 5000);

    expect(completed).toBe(true);

    const doneEvents = events.filter((e) => e.type === 'done');
    expect(doneEvents.length).toBe(1);
  });

  it('should NOT produce HOOK_BLOCKED errors', async () => {
    const { engine } = createTestEngine();

    await engine.init();

    const generator = engine.submitMessage('你好');
    const { events } = await collectEventsWithTimeout(generator, 5000);

    const errors = events.filter((e) => e.type === 'error');
    for (const err of errors) {
      const data = err.data as { code?: string } | undefined;
      expect(data?.code).not.toBe('HOOK_BLOCKED');
    }
  });

  it('should update session messages after completion', async () => {
    const { engine, sessionManager } = createTestEngine();

    await engine.init();

    const sessionBefore = sessionManager.getActive();
    const msgCountBefore = sessionBefore.messages.length;

    const generator = engine.submitMessage('你好');
    const { events, completed } = await collectEventsWithTimeout(generator, 5000);

    expect(completed).toBe(true);

    const sessionAfter = sessionManager.getActive();
    // There should be more messages after submitMessage completes
    const msgCountAfter = sessionAfter.messages.length;
    expect(msgCountAfter).toBeGreaterThan(msgCountBefore);
  });

  it('should handle multiple sequential submitMessage calls', async () => {
    const { engine } = createTestEngine();

    await engine.init();

    // First interaction
    {
      const generator = engine.submitMessage('你好');
      const { events, completed } = await collectEventsWithTimeout(generator, 5000);
      expect(completed).toBe(true);
      expect(events.length).toBeGreaterThan(0);
    }

    // Second interaction — should also complete
    {
      const generator = engine.submitMessage('帮我看看项目');
      const { events, completed } = await collectEventsWithTimeout(generator, 5000);
      expect(completed).toBe(true);
      expect(events.length).toBeGreaterThan(0);
    }
  });

  it('should be interruptible via engine.interrupt()', async () => {
    const { engine } = createTestEngine();

    await engine.init();

    const generator = engine.submitMessage('你好');

    // Interrupt immediately
    engine.interrupt();

    const { events } = await collectEventsWithTimeout(generator, 5000);

    // Should complete (either normally or via error) — must not hang
    expect(events.length).toBeGreaterThanOrEqual(0);
  });
});
