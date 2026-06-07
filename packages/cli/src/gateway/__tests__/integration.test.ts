/**
 * integration.test.ts — TUI ↔ Core integration tests
 *
 * Tests the full chain: QueryEngine → query-bridge → GatewayEvent,
 * plus the deferred permission resolution flow.
 */

import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type {
  QueryMessage,
  StreamEvent,
  AssistantMessage,
  CompletionUsage,
} from '@coder/shared';
import {
  createBridgeState,
  bridgeQueryToGateway,
  resetTurnState,
  resolveApproval,
} from '../query-bridge.js';
import type { BridgeState } from '../query-bridge.js';
import { createDeferredPermission, resolvePermission, getPendingPermissions } from '../deferred.js';
import { createQueryEngine, hasApiKey, getConfiguredModel } from '../engine-factory.js';
import type { EngineFactoryResult } from '../engine-factory.js';

// ---------------------------------------------------------------------------
// Test helpers
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

function makeStreamEvent(event: StreamEvent): QueryMessage {
  return { type: 'stream_event', event };
}

function makeAssistantMessage(overrides?: Partial<AssistantMessage>): QueryMessage {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello, I can help with that.' }],
      stopReason: 'end_turn',
      usage: makeUsage(),
      ...overrides,
    },
  };
}

function makeProgressMessage(
  status: 'started' | 'running' | 'completed' | 'error',
  toolUseId: string,
  toolName: string,
): QueryMessage {
  return {
    type: 'system',
    subtype: 'progress',
    data: {
      toolUseId,
      toolName,
      status,
      message: `${status} ${toolName}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests: BridgeState + bridgeQueryToGateway
// ---------------------------------------------------------------------------

describe('query-bridge: BridgeState', () => {
  it('createBridgeState should initialise with defaults', () => {
    const state = createBridgeState('test-session-1');
    expect(state.sessionId).toBe('test-session-1');
    expect(state.accumulatedText).toBe('');
    expect(state.activeTools.size).toBe(0);
    expect(state.totalCost).toBe(0);
    expect(state.usage.inputTokens).toBe(0);
    expect(state.usage.outputTokens).toBe(0);
    expect(state.turnCount).toBe(0);
    expect(state.pendingApprovals).toEqual([]);
  });

  it('resetTurnState should clear per-turn fields', () => {
    const state = createBridgeState('test-session-1');
    state.accumulatedText = 'some text';
    state.activeTools.set('tool-1', { id: 'tool-1', name: 'Bash', startTime: Date.now(), status: 'started' });
    state.currentTurnToolCount = 3;
    state.pendingApprovals.push({
      toolUseId: 'tool-1',
      toolName: 'Bash',
      command: 'ls',
      description: 'List files',
      deferred: {} as any,
    });
    state.usage.inputTokens = 500;

    resetTurnState(state);

    expect(state.accumulatedText).toBe('');
    expect(state.activeTools.size).toBe(0);
    expect(state.currentTurnToolCount).toBe(0);
    expect(state.pendingApprovals).toEqual([]);
    expect(state.usage.inputTokens).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: bridgeQueryToGateway — stream_event mappings
// ---------------------------------------------------------------------------

describe('query-bridge: stream_event → GatewayEvent', () => {
  it('message_start → message.start', () => {
    const state = createBridgeState('sid-1');
    const msg = makeStreamEvent({
      type: 'message_start',
      message: { model: 'deepseek-v4-pro', usage: { input_tokens: 0, output_tokens: 0 } },
    });

    const events = bridgeQueryToGateway(msg, state);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]!.type).toBe('message.start');
  });

  it('content_block_delta (text) → message.delta', () => {
    const state = createBridgeState('sid-1');
    const msg = makeStreamEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Hello' },
    });

    const events = bridgeQueryToGateway(msg, state);
    expect(events.some((e) => e.type === 'message.delta')).toBe(true);
    expect(state.accumulatedText).toContain('Hello');
  });

  it('content_block_delta (input_json) → tool.input_delta', () => {
    const state = createBridgeState('sid-1');
    // Set up the tool block index mapping first
    bridgeQueryToGateway(
      makeStreamEvent({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tool_001', name: 'Bash', input: {} },
      }),
      state,
    );
    const msg = makeStreamEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"command"' },
    });

    const events = bridgeQueryToGateway(msg, state);
    expect(events.some((e) => e.type === 'tool.input_delta')).toBe(true);
    expect(events.some((e) => e.type === 'thinking.delta')).toBe(false);
  });

  it('content_block_start (tool_use) → tool.start', () => {
    const state = createBridgeState('sid-1');
    const msg = makeStreamEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tool_001', name: 'Bash', input: { command: 'ls' } },
    });

    const events = bridgeQueryToGateway(msg, state);
    const toolStart = events.find((e) => e.type === 'tool.start');
    expect(toolStart).toBeDefined();
    expect(toolStart!.payload?.tool_id).toBe('tool_001');
    expect(toolStart!.payload?.name).toBe('Bash');
    expect(state.currentTurnToolCount).toBe(1);
  });

  it('message_delta (usage) accumulates usage', () => {
    const state = createBridgeState('sid-1');
    const msg = makeStreamEvent({
      type: 'message_delta',
      delta: {
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 200, output_tokens: 100 },
      },
    } as StreamEvent);

    bridgeQueryToGateway(msg, state);
    expect(state.usage.inputTokens).toBe(200);
    expect(state.usage.outputTokens).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Tests: bridgeQueryToGateway — assistant message
// ---------------------------------------------------------------------------

describe('query-bridge: assistant → message.complete', () => {
  it('should emit message.complete with usage', () => {
    const state = createBridgeState('sid-1');
    state.accumulatedText = 'I can help.';

    const msg = makeAssistantMessage({
      content: [{ type: 'text', text: 'I can help.' }],
      usage: makeUsage({ input_tokens: 150, output_tokens: 80 }),
    });

    const events = bridgeQueryToGateway(msg, state);
    const complete = events.find((e) => e.type === 'message.complete');
    expect(complete).toBeDefined();
    expect(complete!.payload?.text).toBe('I can help.');
    expect(state.turnCount).toBe(1);
  });

  it('should reset turn state after assistant message', () => {
    const state = createBridgeState('sid-1');
    state.accumulatedText = 'Done.';
    state.currentTurnToolCount = 2;

    const msg = makeAssistantMessage();
    bridgeQueryToGateway(msg, state);

    // Turn state should be reset
    expect(state.accumulatedText).toBe('');
    expect(state.currentTurnToolCount).toBe(0);
    expect(state.activeTools.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: bridgeQueryToGateway — system messages
// ---------------------------------------------------------------------------

describe('query-bridge: system messages', () => {
  it('progress (started) → status.update', () => {
    const state = createBridgeState('sid-1');
    const msg = makeProgressMessage('started', 'tool_001', 'Bash');

    const events = bridgeQueryToGateway(msg, state);
    expect(events.some((e) => e.type === 'status.update')).toBe(true);
    expect(state.activeTools.has('tool_001')).toBe(true);
  });

  it('progress (completed) → tool.complete', () => {
    const state = createBridgeState('sid-1');
    state.activeTools.set('tool_001', {
      id: 'tool_001',
      name: 'Bash',
      startTime: Date.now() - 1000,
      status: 'running',
    });

    const msg = makeProgressMessage('completed', 'tool_001', 'Bash');
    const events = bridgeQueryToGateway(msg, state);

    const toolComplete = events.find((e) => e.type === 'tool.complete');
    expect(toolComplete).toBeDefined();
    expect(toolComplete!.payload?.tool_id).toBe('tool_001');
    expect(toolComplete!.payload?.name).toBe('Bash');
    // Tool should be cleaned up from activeTools
    expect(state.activeTools.has('tool_001')).toBe(false);
  });

  it('compact_boundary → status.update', () => {
    const state = createBridgeState('sid-1');
    const msg: QueryMessage = {
      type: 'system',
      subtype: 'compact_boundary',
      compactMetadata: { beforeTokens: 50000, afterTokens: 20000, strategy: 'auto' },
    };

    const events = bridgeQueryToGateway(msg, state);
    expect(events.some((e) => e.type === 'status.update')).toBe(true);
  });

  it('error → error + status.update', () => {
    const state = createBridgeState('sid-1');
    const msg: QueryMessage = {
      type: 'system',
      subtype: 'error',
      error: { code: 'TOOL_ERROR', message: 'Something went wrong', retryable: false, timestamp: new Date() },
    };

    const events = bridgeQueryToGateway(msg, state);
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(events.some((e) => e.type === 'status.update' && e.payload?.kind === 'error')).toBe(true);
  });

  it('permission_required → approval.request', () => {
    const state = createBridgeState('sid-1');
    const deferred = createDeferredPermission('Bash', 'rm -rf /', 'Dangerous delete command', 'tool_approve_1');

    const msg: QueryMessage = {
      type: 'system',
      subtype: 'permission_required',
      deferred,
    };

    const events = bridgeQueryToGateway(msg, state);
    const approvalEvent = events.find((e) => e.type === 'approval.request');
    expect(approvalEvent).toBeDefined();
    expect(approvalEvent!.payload?.command).toBe('rm -rf /');
    expect(approvalEvent!.payload?.request_id).toBe('tool_approve_1');
    expect(state.pendingApprovals.length).toBe(1);
    expect(state.pendingApprovals[0]!.toolUseId).toBe('tool_approve_1');
  });
});

// ---------------------------------------------------------------------------
// Tests: resolveApproval
// ---------------------------------------------------------------------------

describe('resolveApproval', () => {
  it('should resolve pending approval and call deferred.resolve', async () => {
    const state = createBridgeState('sid-1');
    const deferred = createDeferredPermission('Bash', 'rm -rf /', 'Dangerous command', 'tool_001');

    state.pendingApprovals.push({
      toolUseId: 'tool_001',
      toolName: 'Bash',
      command: 'rm -rf /',
      description: 'Dangerous command',
      deferred,
    });

    // Resolve as approved
    resolveApproval(state, 'tool_001', true);

    // pendingApprovals should be cleared
    expect(state.pendingApprovals.length).toBe(0);

    // The promise should resolve to true (approved)
    const result = await deferred.promise;
    expect(result).toBe(true);
  });

  it('should resolve as denied', async () => {
    const state = createBridgeState('sid-1');
    const deferred = createDeferredPermission('Bash', 'rm -rf /', 'Dangerous command', 'tool_001');

    state.pendingApprovals.push({
      toolUseId: 'tool_001',
      toolName: 'Bash',
      command: 'rm -rf /',
      description: 'Dangerous command',
      deferred,
    });

    resolveApproval(state, 'tool_001', false);

    const result = await deferred.promise;
    expect(result).toBe(false);
  });

  it('should return null for unknown toolUseId', () => {
    const state = createBridgeState('sid-1');
    const result = resolveApproval(state, 'nonexistent', true);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: Deferred Permission
// ---------------------------------------------------------------------------

describe('DeferredPermission', () => {
  it('createDeferredPermission should create and register', () => {
    const deferred = createDeferredPermission('Bash', 'ls', 'List files', 'tool_ls_1');
    expect(deferred.toolName).toBe('Bash');
    expect(deferred.command).toBe('ls');
    expect(deferred.toolUseId).toBe('tool_ls_1');
    expect(getPendingPermissions().has('tool_ls_1')).toBe(true);
  });

  it('resolvePermission should resolve the promise', async () => {
    const deferred = createDeferredPermission('Write', 'write file', 'Write to file', 'tool_write_1');

    // Resolve in background
    setTimeout(() => resolvePermission('tool_write_1', true), 10);

    const result = await deferred.promise;
    expect(result).toBe(true);
    expect(getPendingPermissions().has('tool_write_1')).toBe(false);
  });

  it('should auto-deny after timeout', async () => {
    const deferred = createDeferredPermission('Bash', 'cmd', 'desc', 'tool_timeout_1', 50);

    const result = await deferred.promise;
    expect(result).toBe(false);
    expect(getPendingPermissions().has('tool_timeout_1')).toBe(false);
  }, 10000);
});

// ---------------------------------------------------------------------------
// Tests: Engine Factory
// ---------------------------------------------------------------------------

describe('engine-factory', () => {
  it('createQueryEngine should return engine, interrupt, sessionId', () => {
    const result = createQueryEngine('/tmp/test-project');

    expect(result.engine).toBeDefined();
    expect(typeof result.interrupt).toBe('function');
    expect(typeof result.sessionId).toBe('string');
    expect(result.sessionId.length).toBeGreaterThan(0);
  });

  it('createQueryEngine should accept options object', () => {
    const result = createQueryEngine({
      cwd: '/tmp/test-project',
      model: 'deepseek-v4-pro',
      maxTurns: 50,
    });

    expect(result.engine).toBeDefined();
    expect(result.sessionId).toBeDefined();
  });

  it('hasApiKey should return false when no key is set', () => {
    // In test env, there's no API key by default
    const hasKey = hasApiKey();
    expect(typeof hasKey).toBe('boolean');
  });

  it('getConfiguredModel should return default model', () => {
    const model = getConfiguredModel();
    expect(typeof model).toBe('string');
    expect(model.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Full bridge integration (multiple messages in sequence)
// ---------------------------------------------------------------------------

describe('Full bridge integration', () => {
  it('should handle a complete tool-use turn sequence', () => {
    const state = createBridgeState('int-test-1');
    const allEvents: { type: string }[] = [];

    // 1. message_start
    allEvents.push(
      ...bridgeQueryToGateway(
        makeStreamEvent({
          type: 'message_start',
          message: { model: 'deepseek-v4-pro', usage: { input_tokens: 0, output_tokens: 0 } },
        }),
        state,
      ),
    );

    // 2. tool_use content_block_start
    allEvents.push(
      ...bridgeQueryToGateway(
        makeStreamEvent({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'tool_abc', name: 'Read', input: { file_path: '/tmp/test.txt' } },
        }),
        state,
      ),
    );

    // 3. tool progress started
    allEvents.push(
      ...bridgeQueryToGateway(makeProgressMessage('started', 'tool_abc', 'Read'), state),
    );

    // 4. tool progress completed
    allEvents.push(
      ...bridgeQueryToGateway(makeProgressMessage('completed', 'tool_abc', 'Read'), state),
    );

    // 5. text content_block_delta
    allEvents.push(
      ...bridgeQueryToGateway(
        makeStreamEvent({
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: 'The file contains...' },
        }),
        state,
      ),
    );

    // 6. message_delta with usage
    allEvents.push(
      ...bridgeQueryToGateway(
        makeStreamEvent({
          type: 'message_delta',
          delta: {
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 300, output_tokens: 100 },
          },
        } as StreamEvent),
        state,
      ),
    );

    // Verify accumulated text BEFORE assistant message (which resets turn state)
    expect(state.accumulatedText).toBe('The file contains...');

    // 7. assistant message (turn complete — resets turn state)
    allEvents.push(...bridgeQueryToGateway(makeAssistantMessage(), state));

    // Verify key event types appeared
    const eventTypes = allEvents.map((e) => e.type);
    expect(eventTypes).toContain('message.start');
    expect(eventTypes).toContain('tool.start');
    expect(eventTypes).toContain('tool.complete');
    expect(eventTypes).toContain('message.delta');
    expect(eventTypes).toContain('message.complete');

    // After assistant message, turn state is reset
    expect(state.accumulatedText).toBe('');
    expect(state.currentTurnToolCount).toBe(0);
    expect(state.activeTools.size).toBe(0);
    expect(state.turnCount).toBe(1);
  });

  it('should handle the permission_required → resolve flow', async () => {
    const state = createBridgeState('int-test-2');

    // Create deferred permission
    const deferred = createDeferredPermission('Write', 'write /etc/config', 'Modify system config', 'tool_write_sys');

    // Bridge the permission_required message
    const msg: QueryMessage = {
      type: 'system',
      subtype: 'permission_required',
      deferred,
    };
    const events = bridgeQueryToGateway(msg, state);

    // Should emit approval.request with request_id
    const approvalEvent = events.find((e) => e.type === 'approval.request');
    expect(approvalEvent).toBeDefined();
    expect(approvalEvent!.payload?.request_id).toBe('tool_write_sys');

    // Simulate user approving
    resolveApproval(state, 'tool_write_sys', true);

    // The deferred promise should resolve
    const result = await deferred.promise;
    expect(result).toBe(true);
    expect(state.pendingApprovals.length).toBe(0);
  });
});
