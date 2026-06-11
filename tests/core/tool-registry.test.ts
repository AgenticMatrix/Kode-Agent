import { describe, expect, it, beforeEach } from 'vitest';
import { ToolRegistry } from '../../src/core/tool-registry.js';
import type { ToolDefinition, ToolContext, ToolExecutionResult } from '../../src/core/types.js';

function makeDef(name: string): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    input_schema: { type: 'object', properties: {} },
  };
}

async function noop(): Promise<ToolExecutionResult> {
  return { content: 'ok', isError: false };
}

const CTX: ToolContext = { sessionId: 's1', cwd: '/tmp' };

describe('ToolRegistry', () => {
  let reg: ToolRegistry;

  beforeEach(() => {
    reg = new ToolRegistry();
  });

  it('should register a tool', () => {
    reg.register(makeDef('Read'), noop);
    expect(reg.names).toContain('Read');
  });

  it('should get a registered tool', () => {
    reg.register(makeDef('Read'), noop);
    const entry = reg.get('Read');
    expect(entry).toBeDefined();
    expect(entry!.definition.name).toBe('Read');
  });

  it('should return undefined for unknown tool', () => {
    expect(reg.get('Unknown')).toBeUndefined();
  });

  it('should list all definitions', () => {
    reg.register(makeDef('Read'), noop);
    reg.register(makeDef('Write'), noop);
    expect(reg.getDefinitions()).toHaveLength(2);
  });

  it('should return Anthropic-compatible tools', () => {
    reg.register(makeDef('Read'), noop);
    const tools = reg.getAnthropicTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe('Read');
    expect(tools[0]!.description).toBe('Read tool');
    // Must not leak internal _meta
    expect((tools[0]! as any)._meta).toBeUndefined();
  });

  it('should execute a registered tool', async () => {
    reg.register(makeDef('Read'), async (input) => ({
      content: `read ${input.path}`, isError: false,
    }));
    const result = await reg.execute('Read', { path: '/f.txt' }, CTX);
    expect(result.content).toContain('read /f.txt');
    expect(result.isError).toBe(false);
  });

  it('should return error for unknown tool execution', async () => {
    const result = await reg.execute('Unknown', {}, CTX);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Unknown tool');
  });

  it('should list all names', () => {
    reg.register(makeDef('Read'), noop);
    reg.register(makeDef('Write'), noop);
    expect(reg.names.sort()).toEqual(['Read', 'Write']);
  });
});
