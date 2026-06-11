import { describe, expect, it, beforeEach } from 'vitest';
import { SubAgentRegistry } from '../../src/core/subagent-registry.js';

describe('SubAgentRegistry', () => {
  let registry: SubAgentRegistry;

  beforeEach(() => {
    registry = new SubAgentRegistry();
  });

  it('should register a sub-agent', () => {
    registry.register({
      id: 'sub-001',
      name: 'explore-sub-001',
      agentType: 'explore',
      status: 'running',
      prompt: 'Find all test files',
      createdAt: Date.now(),
      turnCount: 0,
      messageCount: 0,
      toolCount: 0,
      abortController: new AbortController(),
    });

    expect(registry.get('sub-001')).toBeDefined();
    expect(registry.get('sub-001')!.agentType).toBe('explore');
  });

  it('should list all registered agents', () => {
    registry.register({
      id: 'sub-001', name: 'a', agentType: 'explore', status: 'running',
      prompt: 'p1', createdAt: Date.now(), turnCount: 0, messageCount: 0,
      toolCount: 0, abortController: new AbortController(),
    });
    registry.register({
      id: 'sub-002', name: 'b', agentType: 'plan', status: 'done',
      prompt: 'p2', createdAt: Date.now(), turnCount: 3, messageCount: 5,
      toolCount: 2, abortController: new AbortController(),
    });

    expect(registry.list()).toHaveLength(2);
  });

  it('should filter by status', () => {
    registry.register({
      id: 'sub-001', name: 'a', agentType: 'explore', status: 'running',
      prompt: 'p1', createdAt: Date.now(), turnCount: 0, messageCount: 0,
      toolCount: 0, abortController: new AbortController(),
    });
    registry.register({
      id: 'sub-002', name: 'b', agentType: 'plan', status: 'done',
      prompt: 'p2', createdAt: Date.now(), turnCount: 3, messageCount: 5,
      toolCount: 2, abortController: new AbortController(),
    });

    expect(registry.listByStatus('done')).toHaveLength(1);
    expect(registry.listByStatus('done')[0]!.id).toBe('sub-002');
    expect(registry.listByStatus('running')).toHaveLength(1);
    expect(registry.listByStatus('error')).toHaveLength(0);
  });

  it('should update agent fields', () => {
    registry.register({
      id: 'sub-001', name: 'a', agentType: 'explore', status: 'running',
      prompt: 'p1', createdAt: Date.now(), turnCount: 0, messageCount: 0,
      toolCount: 0, abortController: new AbortController(),
    });

    registry.update('sub-001', { turnCount: 5, toolCount: 3 });

    const agent = registry.get('sub-001')!;
    expect(agent.turnCount).toBe(5);
    expect(agent.toolCount).toBe(3);
    expect(agent.status).toBe('running'); // unchanged
  });

  it('should abort a running agent', () => {
    const ctrl = new AbortController();
    registry.register({
      id: 'sub-001', name: 'a', agentType: 'explore', status: 'running',
      prompt: 'p1', createdAt: Date.now(), turnCount: 0, messageCount: 0,
      toolCount: 0, abortController: ctrl,
    });

    const stopped = registry.abort('sub-001');
    expect(stopped).toBe(true);
    expect(ctrl.signal.aborted).toBe(true);
  });

  it('should not abort a non-running agent', () => {
    registry.register({
      id: 'sub-001', name: 'a', agentType: 'explore', status: 'done',
      prompt: 'p1', createdAt: Date.now(), turnCount: 3, messageCount: 5,
      toolCount: 2, abortController: new AbortController(),
    });

    expect(registry.abort('sub-001')).toBe(false);
  });

  it('should return undefined for unknown agent', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });
});
