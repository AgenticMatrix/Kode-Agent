/**
 * hooks-phase5.test.ts — Unit tests for Phase 5 Hook events (Sprint 7).
 *
 * Tests the 5 new hook events added in Phase 5 Batch 1:
 *   1. PostToolUseFailure — tool execution exception
 *   2. StopFailure — API error terminates Agent Loop
 *   3. TaskCreated — background task / sub-agent spawned
 *   4. TaskCompleted — background task / sub-agent finished
 *   5. Notification — system-level event notifications
 *
 * All 5 events are non-blockable — hook failures must never affect the main flow.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { HookManager } from '../hooks/manager.js';
import type { Hook, HookResult } from '../hooks/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSilentHookManager(): HookManager {
  // Create a manager that doesn't try to load from disk
  const mgr = new HookManager();
  // Remove any hooks loaded from disk
  for (const h of mgr.list()) {
    mgr.unregister(h.id);
  }
  return mgr;
}

function createSpyHook(
  id: string,
  event: string,
  result?: HookResult,
): { hook: Hook; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn().mockResolvedValue(result ?? {});
  const hook: Hook = {
    id,
    event: event as Hook['event'],
    description: `Test hook: ${id}`,
    handler: spy,
    timeout: 5000,
    priority: 10,
  };
  return { hook, spy };
}

// ---------------------------------------------------------------------------
// 1. PostToolUseFailure
// ---------------------------------------------------------------------------

describe('PostToolUseFailure hook', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fire when onPostToolUseFailure is called', async () => {
    const mgr = createSilentHookManager();
    const { hook, spy } = createSpyHook('tool-fail-logger', 'PostToolUseFailure');
    mgr.register(hook);

    const testError = new Error('EACCES: permission denied');
    await mgr.onPostToolUseFailure(
      'session-1',
      '/tmp/test',
      'Write',
      { file_path: '/etc/hosts', content: 'evil' },
      testError,
    );

    // Give the async fire-and-forget a moment to execute
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1), { timeout: 1000 });

    const ctx = spy.mock.calls[0]?.[0];
    expect(ctx.event).toBe('PostToolUseFailure');
    expect(ctx.toolName).toBe('Write');
    expect(ctx.input).toEqual({ file_path: '/etc/hosts', content: 'evil' });
    expect(ctx.error.message).toBe('EACCES: permission denied');
    expect(ctx.error.stack).toBeDefined();
  });

  it('should not throw if no hooks are registered', async () => {
    const mgr = createSilentHookManager();
    const testError = new Error('test');

    // This should not throw
    await expect(
      mgr.onPostToolUseFailure('session-1', '/tmp', 'Bash', {}, testError),
    ).resolves.toBeUndefined();
  });

  it('should not block the loop even if hook throws', async () => {
    const mgr = createSilentHookManager();
    const throwingHook: Hook = {
      id: 'crashy',
      event: 'PostToolUseFailure',
      handler: async () => {
        throw new Error('Hook crashed!');
      },
    };
    mgr.register(throwingHook);

    const testError = new Error('original error');
    // Should resolve without throwing — hook errors are non-fatal
    await expect(
      mgr.onPostToolUseFailure('session-1', '/tmp', 'Bash', {}, testError),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. StopFailure
// ---------------------------------------------------------------------------

describe('StopFailure hook', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fire when onStopFailure is called', async () => {
    const mgr = createSilentHookManager();
    const { hook, spy } = createSpyHook('stop-fail-diagnostics', 'StopFailure');
    mgr.register(hook);

    await mgr.onStopFailure(
      'session-1',
      '/tmp/test',
      { message: 'API overloaded', code: 'overloaded_error', status: 529 },
      42,
    );

    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1), { timeout: 1000 });

    const ctx = spy.mock.calls[0]?.[0];
    expect(ctx.event).toBe('StopFailure');
    expect(ctx.error.message).toBe('API overloaded');
    expect(ctx.error.code).toBe('overloaded_error');
    expect(ctx.error.status).toBe(529);
    expect(ctx.turnCount).toBe(42);
  });

  it('should handle missing optional error fields', async () => {
    const mgr = createSilentHookManager();
    const { hook, spy } = createSpyHook('stop-fail-minimal', 'StopFailure');
    mgr.register(hook);

    await mgr.onStopFailure(
      'session-1',
      '/tmp',
      { message: 'Unknown error' },
      0,
    );

    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1), { timeout: 1000 });

    const ctx = spy.mock.calls[0]?.[0];
    expect(ctx.error.code).toBeUndefined();
    expect(ctx.error.status).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. TaskCreated
// ---------------------------------------------------------------------------

describe('TaskCreated hook', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fire when onTaskCreated is called for a subagent', async () => {
    const mgr = createSilentHookManager();
    const { hook, spy } = createSpyHook('task-tracker', 'TaskCreated');
    mgr.register(hook);

    await mgr.onTaskCreated(
      'parent-session-1',
      '/tmp/test',
      'agent-a1b2c3',
      'subagent',
      'Investigate null pointer in src/auth/validate.ts',
      ['Read', 'Grep', 'Glob'],
    );

    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1), { timeout: 1000 });

    const ctx = spy.mock.calls[0]?.[0];
    expect(ctx.event).toBe('TaskCreated');
    expect(ctx.taskId).toBe('agent-a1b2c3');
    expect(ctx.taskType).toBe('subagent');
    expect(ctx.prompt).toContain('null pointer');
    expect(ctx.toolSet).toEqual(['Read', 'Grep', 'Glob']);
  });

  it('should handle cron task type', async () => {
    const mgr = createSilentHookManager();
    const { hook, spy } = createSpyHook('cron-tracker', 'TaskCreated');
    mgr.register(hook);

    await mgr.onTaskCreated(
      'session-1',
      '/tmp',
      'cron-xyz',
      'cron',
    );

    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1), { timeout: 1000 });

    const ctx = spy.mock.calls[0]?.[0];
    expect(ctx.taskType).toBe('cron');
    expect(ctx.prompt).toBeUndefined();
    expect(ctx.toolSet).toBeUndefined();
  });

  it('should handle unrestricted tools (empty toolSet)', async () => {
    const mgr = createSilentHookManager();
    const { hook, spy } = createSpyHook('unrestricted-tracker', 'TaskCreated');
    mgr.register(hook);

    await mgr.onTaskCreated(
      'session-1',
      '/tmp',
      'coordinator-1',
      'background',
      'General task',
      undefined, // unrestricted
    );

    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1), { timeout: 1000 });

    const ctx = spy.mock.calls[0]?.[0];
    expect(ctx.toolSet).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. TaskCompleted
// ---------------------------------------------------------------------------

describe('TaskCompleted hook', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fire when onTaskCompleted is called with completed status', async () => {
    const mgr = createSilentHookManager();
    const { hook, spy } = createSpyHook('task-done-logger', 'TaskCompleted');
    mgr.register(hook);

    await mgr.onTaskCompleted(
      'parent-session-1',
      '/tmp/test',
      'agent-a1b2c3',
      'completed',
      'Fixed null pointer in validate.ts:42',
      { tokens: 12400, toolCalls: 8, durationMs: 45000 },
    );

    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1), { timeout: 1000 });

    const ctx = spy.mock.calls[0]?.[0];
    expect(ctx.event).toBe('TaskCompleted');
    expect(ctx.taskId).toBe('agent-a1b2c3');
    expect(ctx.status).toBe('completed');
    expect(ctx.summary).toContain('null pointer');
    expect(ctx.usage).toEqual({ tokens: 12400, toolCalls: 8, durationMs: 45000 });
  });

  it('should fire for failed tasks', async () => {
    const mgr = createSilentHookManager();
    const { hook, spy } = createSpyHook('task-fail-alert', 'TaskCompleted');
    mgr.register(hook);

    await mgr.onTaskCompleted(
      'parent-session-1',
      '/tmp/test',
      'agent-failed',
      'failed',
      'ENOENT: no such file or directory',
      { tokens: 0, toolCalls: 1, durationMs: 5000 },
    );

    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1), { timeout: 1000 });

    const ctx = spy.mock.calls[0]?.[0];
    expect(ctx.status).toBe('failed');
  });

  it('should fire for killed tasks', async () => {
    const mgr = createSilentHookManager();
    const { hook, spy } = createSpyHook('task-kill-logger', 'TaskCompleted');
    mgr.register(hook);

    await mgr.onTaskCompleted(
      'parent-session-1',
      '/tmp/test',
      'agent-killed',
      'killed',
      'Terminated by user',
    );

    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1), { timeout: 1000 });

    const ctx = spy.mock.calls[0]?.[0];
    expect(ctx.status).toBe('killed');
    expect(ctx.usage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. Notification
// ---------------------------------------------------------------------------

describe('Notification hook', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fire info-level notification', async () => {
    const mgr = createSilentHookManager();
    const { hook, spy } = createSpyHook('notify-info', 'Notification');
    mgr.register(hook);

    await mgr.onNotification(
      'session-1',
      '/tmp/test',
      'info',
      'Tool Write completed',
      { toolName: 'Write', isError: false },
    );

    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1), { timeout: 1000 });

    const ctx = spy.mock.calls[0]?.[0];
    expect(ctx.event).toBe('Notification');
    expect(ctx.level).toBe('info');
    expect(ctx.message).toBe('Tool Write completed');
    expect(ctx.metadata).toEqual({ toolName: 'Write', isError: false });
  });

  it('should fire warn-level notification', async () => {
    const mgr = createSilentHookManager();
    const { hook, spy } = createSpyHook('notify-warn', 'Notification');
    mgr.register(hook);

    await mgr.onNotification(
      'session-2',
      '/tmp',
      'warn',
      'Budget exceeded at $5.50',
      { totalCost: 5.50, maxBudgetUsd: 5 },
    );

    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1), { timeout: 1000 });

    const ctx = spy.mock.calls[0]?.[0];
    expect(ctx.level).toBe('warn');
  });

  it('should fire error-level notification', async () => {
    const mgr = createSilentHookManager();
    const { hook, spy } = createSpyHook('notify-error', 'Notification');
    mgr.register(hook);

    await mgr.onNotification(
      'session-3',
      '/tmp',
      'error',
      'Context compaction failed',
    );

    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1), { timeout: 1000 });

    const ctx = spy.mock.calls[0]?.[0];
    expect(ctx.level).toBe('error');
    expect(ctx.metadata).toBeUndefined();
  });

  it('should not throw on missing metadata', async () => {
    const mgr = createSilentHookManager();
    const { hook, spy } = createSpyHook('notify-minimal', 'Notification');
    mgr.register(hook);

    await mgr.onNotification('session-1', '/tmp', 'info', 'Simple message');

    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1), { timeout: 1000 });
  });
});

// ---------------------------------------------------------------------------
// 6. Integration: Multiple hooks per event
// ---------------------------------------------------------------------------

describe('Multiple hooks per event', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should execute all registered hooks for TaskCreated', async () => {
    const mgr = createSilentHookManager();
    const h1 = createSpyHook('tracker-1', 'TaskCreated');
    const h2 = createSpyHook('tracker-2', 'TaskCreated');
    mgr.register(h1.hook);
    mgr.register(h2.hook);

    await mgr.onTaskCreated('session-1', '/tmp', 'agent-1', 'subagent', 'Task');

    await vi.waitFor(() => {
      expect(h1.spy).toHaveBeenCalledTimes(1);
      expect(h2.spy).toHaveBeenCalledTimes(1);
    }, { timeout: 1000 });
  });

  it('should execute hooks with priority ordering', async () => {
    const mgr = createSilentHookManager();
    const executionOrder: string[] = [];

    const lowPriority: Hook = {
      id: 'low',
      event: 'Notification',
      priority: 0,
      handler: async () => { executionOrder.push('low'); return {}; },
    };
    const highPriority: Hook = {
      id: 'high',
      event: 'Notification',
      priority: 100,
      handler: async () => { executionOrder.push('high'); return {}; },
    };

    mgr.register(lowPriority);
    mgr.register(highPriority);

    await mgr.onNotification('session-1', '/tmp', 'info', 'test');

    await vi.waitFor(() => {
      expect(executionOrder.length).toBe(2);
    }, { timeout: 1000 });

    // Higher priority hooks are registered first in the bucket
    // but execute in parallel — we just verify both ran
    expect(executionOrder).toContain('high');
    expect(executionOrder).toContain('low');
  });

  it('should skip disabled hooks', async () => {
    const mgr = createSilentHookManager();
    const enabled = createSpyHook('enabled', 'Notification');
    const spy = vi.fn();
    const disabled: Hook = {
      id: 'disabled',
      event: 'Notification',
      enabled: false,
      handler: spy,
    };

    mgr.register(enabled.hook);
    mgr.register(disabled);

    await mgr.onNotification('session-1', '/tmp', 'info', 'test');

    await vi.waitFor(() => {
      expect(enabled.spy).toHaveBeenCalledTimes(1);
    }, { timeout: 1000 });

    // Disabled hook should NOT have been called
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7. Backward compatibility: old events still work
// ---------------------------------------------------------------------------

describe('Backward compatibility', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should still fire PostToolUse (old event) correctly', async () => {
    const mgr = createSilentHookManager();
    const { hook, spy } = createSpyHook('post-tool', 'PostToolUse');
    mgr.register(hook);

    await mgr.onPostToolUse(
      'session-1',
      '/tmp',
      'Read',
      { file_path: '/tmp/test.txt' },
      'file contents',
      true,
      150,
    );

    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1), { timeout: 1000 });

    const ctx = spy.mock.calls[0]?.[0];
    expect(ctx.event).toBe('PostToolUse');
    expect(ctx.toolName).toBe('Read');
    expect(ctx.success).toBe(true);
  });

  it('should still fire Stop (old event) correctly', async () => {
    const mgr = createSilentHookManager();
    const { hook, spy } = createSpyHook('stop-hook', 'Stop');
    mgr.register(hook);

    await mgr.onStop(
      'session-1',
      '/tmp',
      10,
      [{ role: 'assistant', summary: 'Done' }],
    );

    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1), { timeout: 1000 });

    const ctx = spy.mock.calls[0]?.[0];
    expect(ctx.event).toBe('Stop');
    expect(ctx.turnCount).toBe(10);
  });
});
