import { describe, expect, it } from 'vitest';
import { SubAgentRegistry } from '../../src/core/subagent-registry.js';
import type { AgentSpawnContext, ToolDefinition, Message } from '../../src/core/types.js';

function makeToolDef(name: string): ToolDefinition {
  return { name, description: `${name} tool`, input_schema: { type: 'object', properties: {} } };
}

function emptyCallModel(): AgentSpawnContext['callModel'] {
  return (async function* () {})() as ReturnType<AgentSpawnContext['callModel']>;
}

function buildAgentSpawn(overrides: Partial<AgentSpawnContext> = {}): AgentSpawnContext {
  return {
    callModel: emptyCallModel(),
    toolRegistry: {
      getDefinitions: () => [],
      get: () => undefined,
      register: () => {},
      execute: async () => ({ content: '', isError: false }),
      has: () => false,
    } as unknown as AgentSpawnContext['toolRegistry'],
    sessionManager: {
      getActive: () => ({ id: 's1', messages: [], title: '', status: 'active', cwd: '/tmp', model: 'test' }),
      create: () => ({ id: 's1', title: '', status: 'active', cwd: '/tmp', model: 'test', messages: [] }),
      addMessage: () => {},
      get: () => undefined,
    } as unknown as AgentSpawnContext['sessionManager'],
    subAgentRegistry: new SubAgentRegistry(),
    systemPromptAssembler: {
      assemble: async () => ({ prompt: 'test', parts: [] }),
    } as unknown as AgentSpawnContext['systemPromptAssembler'],
    agentRegistry: {
      get: () => undefined,
      list: () => [],
      register: () => {},
      getDefinitionsResult: () => ({ activeAgents: [], allAgents: [] }),
    } as unknown as AgentSpawnContext['agentRegistry'],
    ...overrides,
  };
}

function seedAgent(registry: SubAgentRegistry, id: string, overrides: Partial<{ status: string; agentType: string; result: string; error: string; transcript: Message[] }> = {}) {
  registry.register({
    id,
    name: `test-${id}`,
    agentType: (overrides.agentType as 'general-purpose') ?? 'general-purpose',
    status: (overrides.status as 'running' | 'done' | 'error' | 'stopped') ?? 'running',
    prompt: 'Test prompt',
    createdAt: Date.now() - 10_000,
    turnCount: 3,
    messageCount: 8,
    toolCount: 5,
    result: overrides.result,
    error: overrides.error,
    transcript: overrides.transcript,
    abortController: new AbortController(),
  });
}

// ---------------------------------------------------------------------------
// agent-read
// ---------------------------------------------------------------------------

describe('agent-read executor', () => {
  it('should require agentSpawn context', async () => {
    const { execute } = await import('../../src/agents/agent-read/executor.js');
    const result = await execute({}, { sessionId: 's1', cwd: '/tmp', signal: new AbortController().signal });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('agentSpawn');
  });

  it('should return error when no agent_id or list_all', async () => {
    const agentSpawn = buildAgentSpawn();
    const { execute } = await import('../../src/agents/agent-read/executor.js');
    const result = await execute({}, { agentSpawn, sessionId: 's1', cwd: '/tmp', signal: new AbortController().signal });
    expect(result.isError).toBe(true);
  });

  it('should list all agents when list_all=true', async () => {
    const agentSpawn = buildAgentSpawn();
    seedAgent(agentSpawn.subAgentRegistry, 'sub-abc', { status: 'done', result: 'Done result' });
    seedAgent(agentSpawn.subAgentRegistry, 'sub-def', { status: 'running' });

    const { execute } = await import('../../src/agents/agent-read/executor.js');
    const result = await execute({ list_all: true }, { agentSpawn, sessionId: 's1', cwd: '/tmp', signal: new AbortController().signal });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('sub-abc');
    expect(result.content).toContain('sub-def');
    expect(result.content).toContain('done');
    expect(result.content).toContain('running');
    expect(result.content).toContain('Done result');
  });

  it('should return empty list when no agents', async () => {
    const agentSpawn = buildAgentSpawn();
    const { execute } = await import('../../src/agents/agent-read/executor.js');
    const result = await execute({ list_all: true }, { agentSpawn, sessionId: 's1', cwd: '/tmp', signal: new AbortController().signal });
    expect(result.content).toBe('No sub-agents found.');
  });

  it('should return single agent details by id', async () => {
    const agentSpawn = buildAgentSpawn();
    seedAgent(agentSpawn.subAgentRegistry, 'sub-xyz', { status: 'done', result: 'Full result text here' });

    const { execute } = await import('../../src/agents/agent-read/executor.js');
    const result = await execute({ agent_id: 'sub-xyz' }, { agentSpawn, sessionId: 's1', cwd: '/tmp', signal: new AbortController().signal });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('sub-xyz');
    expect(result.content).toContain('done');
    expect(result.content).toContain('Full result text here');
  });

  it('should show "Still running" for running agents', async () => {
    const agentSpawn = buildAgentSpawn();
    seedAgent(agentSpawn.subAgentRegistry, 'sub-run', { status: 'running' });

    const { execute } = await import('../../src/agents/agent-read/executor.js');
    const result = await execute({ agent_id: 'sub-run' }, { agentSpawn, sessionId: 's1', cwd: '/tmp', signal: new AbortController().signal });

    expect(result.content).toContain('Still running');
  });

  it('should show error message for errored agents', async () => {
    const agentSpawn = buildAgentSpawn();
    seedAgent(agentSpawn.subAgentRegistry, 'sub-err', { status: 'error', error: 'Something broke' });

    const { execute } = await import('../../src/agents/agent-read/executor.js');
    const result = await execute({ agent_id: 'sub-err' }, { agentSpawn, sessionId: 's1', cwd: '/tmp', signal: new AbortController().signal });

    expect(result.content).toContain('Something broke');
  });

  it('should return error for unknown agent_id', async () => {
    const agentSpawn = buildAgentSpawn();
    const { execute } = await import('../../src/agents/agent-read/executor.js');
    const result = await execute({ agent_id: 'nonexistent' }, { agentSpawn, sessionId: 's1', cwd: '/tmp', signal: new AbortController().signal });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// agent-stop
// ---------------------------------------------------------------------------

describe('agent-stop executor', () => {
  it('should require agentSpawn context', async () => {
    const { execute } = await import('../../src/agents/agent-stop/executor.js');
    const result = await execute({ agent_id: 'sub-1' }, { sessionId: 's1', cwd: '/tmp', signal: new AbortController().signal });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('agentSpawn');
  });

  it('should return error for unknown agent', async () => {
    const agentSpawn = buildAgentSpawn();
    const { execute } = await import('../../src/agents/agent-stop/executor.js');
    const result = await execute({ agent_id: 'nonexistent' }, { agentSpawn, sessionId: 's1', cwd: '/tmp', signal: new AbortController().signal });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not found');
  });

  it('should return message when agent is already done', async () => {
    const agentSpawn = buildAgentSpawn();
    seedAgent(agentSpawn.subAgentRegistry, 'sub-done', { status: 'done' });

    const { execute } = await import('../../src/agents/agent-stop/executor.js');
    const result = await execute({ agent_id: 'sub-done' }, { agentSpawn, sessionId: 's1', cwd: '/tmp', signal: new AbortController().signal });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('already done');
  });

  it('should stop a running agent', async () => {
    const agentSpawn = buildAgentSpawn();
    seedAgent(agentSpawn.subAgentRegistry, 'sub-running', { status: 'running' });

    const { execute } = await import('../../src/agents/agent-stop/executor.js');
    const result = await execute({ agent_id: 'sub-running' }, { agentSpawn, sessionId: 's1', cwd: '/tmp', signal: new AbortController().signal });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('stopped');
  });
});

// ---------------------------------------------------------------------------
// agent-message
// ---------------------------------------------------------------------------

describe('agent-message executor', () => {
  it('should require agentSpawn context', async () => {
    const { execute } = await import('../../src/agents/agent-message/executor.js');
    const result = await execute({}, { sessionId: 's1', cwd: '/tmp', signal: new AbortController().signal });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('agentSpawn');
  });

  it('should require agent_id and message', async () => {
    const agentSpawn = buildAgentSpawn();
    const { execute } = await import('../../src/agents/agent-message/executor.js');

    const r1 = await execute({}, { agentSpawn, sessionId: 's1', cwd: '/tmp', signal: new AbortController().signal });
    expect(r1.isError).toBe(true);
    expect(r1.content).toContain('required');

    const r2 = await execute({ agent_id: 'sub-1' }, { agentSpawn, sessionId: 's1', cwd: '/tmp', signal: new AbortController().signal });
    expect(r2.isError).toBe(true);
    expect(r2.content).toContain('required');
  });

  it('should return error for unknown agent', async () => {
    const agentSpawn = buildAgentSpawn();
    const { execute } = await import('../../src/agents/agent-message/executor.js');
    const result = await execute(
      { agent_id: 'nonexistent', message: 'Hello' },
      { agentSpawn, sessionId: 's1', cwd: '/tmp', signal: new AbortController().signal },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not found');
  });

  it('should reject messaging a running agent', async () => {
    const agentSpawn = buildAgentSpawn();
    seedAgent(agentSpawn.subAgentRegistry, 'sub-running', { status: 'running' });

    const { execute } = await import('../../src/agents/agent-message/executor.js');
    const result = await execute(
      { agent_id: 'sub-running', message: 'Hello' },
      { agentSpawn, sessionId: 's1', cwd: '/tmp', signal: new AbortController().signal },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Cannot message running');
  });
});
