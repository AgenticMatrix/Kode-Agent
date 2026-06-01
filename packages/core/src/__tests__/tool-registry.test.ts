import { describe, expect, it, beforeEach } from 'vitest';
import { ToolRegistry, CATEGORY_MAP } from '../tool-registry.js';
import { BaseTool, RiskLevel } from '@kode/shared';
import type { ToolDefinition, ToolContext, ToolExecutionResult } from '@kode/shared';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

class MockReadTool extends BaseTool {
  get definition(): ToolDefinition {
    return {
      name: 'Read',
      description: 'Read a file',
      inputSchema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] },
      riskLevel: RiskLevel.SAFE,
    };
  }

  async execute(input: unknown, _ctx: ToolContext): Promise<string> {
    const { file_path } = input as { file_path: string };
    return `Content of ${file_path}`;
  }
}

class MockWriteTool extends BaseTool {
  get definition(): ToolDefinition {
    return {
      name: 'Write',
      description: 'Write a file',
      inputSchema: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] },
      riskLevel: RiskLevel.MUTATION,
    };
  }

  async execute(input: unknown, _ctx: ToolContext): Promise<string> {
    const { file_path } = input as { file_path: string };
    return `Wrote ${file_path}`;
  }
}

class MockBashTool extends BaseTool {
  get definition(): ToolDefinition {
    return {
      name: 'Bash',
      description: 'Execute a bash command',
      inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
      riskLevel: RiskLevel.DESTRUCTIVE,
    };
  }

  async execute(_input: unknown, _ctx: ToolContext): Promise<string> {
    return 'executed';
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('register', () => {
    it('should register a single tool', () => {
      const tool = new MockReadTool();
      registry.register(tool);
      expect(registry.size).toBe(1);
      expect(registry.get('Read')).toBeDefined();
    });

    it('should throw on duplicate registration', () => {
      registry.register(new MockReadTool());
      expect(() => registry.register(new MockReadTool())).toThrow('Tool already registered: Read');
    });
  });

  describe('registerAll', () => {
    it('should register multiple tools', () => {
      registry.registerAll([new MockReadTool(), new MockWriteTool()]);
      expect(registry.size).toBe(2);
    });
  });

  describe('unregister', () => {
    it('should remove a tool', () => {
      registry.register(new MockReadTool());
      expect(registry.unregister('Read')).toBe(true);
      expect(registry.size).toBe(0);
    });

    it('should return false for non-existent tool', () => {
      expect(registry.unregister('Nope')).toBe(false);
    });
  });

  describe('get', () => {
    it('should get a registered tool by name', () => {
      registry.register(new MockReadTool());
      const entry = registry.get('Read');
      expect(entry).toBeDefined();
      expect(entry!.definition.name).toBe('Read');
    });

    it('should return undefined for unknown tool', () => {
      expect(registry.get('Unknown')).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('should return all registered tools', () => {
      registry.registerAll([new MockReadTool(), new MockWriteTool()]);
      const all = registry.getAll();
      expect(all).toHaveLength(2);
    });

    it('should return empty array when no tools registered', () => {
      expect(registry.getAll()).toEqual([]);
    });
  });

  describe('getDefinitions', () => {
    it('should return tool definitions', () => {
      registry.registerAll([new MockReadTool(), new MockWriteTool()]);
      const defs = registry.getDefinitions();
      expect(defs).toHaveLength(2);
      expect(defs[0]!.name).toBeDefined();
      expect(defs[0]!.riskLevel).toBeDefined();
    });
  });

  describe('getDefinitionsForMode', () => {
    it('should filter to SAFE tools in plan mode', () => {
      registry.registerAll([new MockReadTool(), new MockWriteTool(), new MockBashTool()]);
      const defs = registry.getDefinitionsForMode('plan');
      expect(defs).toHaveLength(1);
      expect(defs[0]!.name).toBe('Read');
    });

    it('should return all tools in ask mode', () => {
      registry.registerAll([new MockReadTool(), new MockWriteTool(), new MockBashTool()]);
      const defs = registry.getDefinitionsForMode('ask');
      expect(defs).toHaveLength(3);
    });

    it('should return all tools in auto mode', () => {
      registry.registerAll([new MockReadTool(), new MockBashTool()]);
      const defs = registry.getDefinitionsForMode('auto');
      expect(defs).toHaveLength(2);
    });
  });

  describe('getByCategory', () => {
    it('should filter by file_system category', () => {
      registry.registerAll([new MockReadTool(), new MockWriteTool(), new MockBashTool()]);
      const fileTools = registry.getByCategory('file_system');
      expect(fileTools).toHaveLength(2);
    });

    it('should filter by shell category', () => {
      registry.registerAll([new MockReadTool(), new MockBashTool()]);
      const shellTools = registry.getByCategory('shell');
      expect(shellTools).toHaveLength(1);
      expect(shellTools[0]!.definition.name).toBe('Bash');
    });

    it('should return empty for unknown category', () => {
      registry.register(new MockReadTool());
      expect(registry.getByCategory('browser')).toHaveLength(0);
    });
  });

  describe('getByRiskLevel', () => {
    it('should filter by SAFE risk level', () => {
      registry.registerAll([new MockReadTool(), new MockWriteTool(), new MockBashTool()]);
      const safe = registry.getByRiskLevel(RiskLevel.SAFE);
      expect(safe).toHaveLength(1);
      expect(safe[0]!.definition.name).toBe('Read');
    });

    it('should filter by MUTATION risk level', () => {
      registry.registerAll([new MockReadTool(), new MockWriteTool()]);
      const mutation = registry.getByRiskLevel(RiskLevel.MUTATION);
      expect(mutation).toHaveLength(1);
      expect(mutation[0]!.definition.name).toBe('Write');
    });

    it('should filter by DESTRUCTIVE risk level', () => {
      registry.registerAll([new MockReadTool(), new MockBashTool()]);
      const destructive = registry.getByRiskLevel(RiskLevel.DESTRUCTIVE);
      expect(destructive).toHaveLength(1);
      expect(destructive[0]!.definition.name).toBe('Bash');
    });
  });

  describe('execute', () => {
    it('should execute a registered tool', async () => {
      registry.register(new MockReadTool());
      const result = await registry.execute('Read', { file_path: '/tmp/test.txt' }, {
        sessionId: 's1', cwd: '/tmp',
      });
      expect(result.success).toBe(true);
      expect(result.output).toContain('/tmp/test.txt');
    });

    it('should return error for unknown tool', async () => {
      const result = await registry.execute('Unknown', {}, {
        sessionId: 's1', cwd: '/tmp',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });
  });

  describe('iteration', () => {
    it('should be iterable', () => {
      registry.registerAll([new MockReadTool(), new MockWriteTool()]);
      const names: string[] = [];
      for (const entry of registry) {
        names.push(entry.definition.name);
      }
      expect(names.sort()).toEqual(['Read', 'Write']);
    });
  });
});

describe('CATEGORY_MAP', () => {
  it('should map Read to file_system', () => {
    expect(CATEGORY_MAP['Read']).toBe('file_system');
  });

  it('should map Bash to shell', () => {
    expect(CATEGORY_MAP['Bash']).toBe('shell');
  });

  it('should map Grep to search', () => {
    expect(CATEGORY_MAP['Grep']).toBe('search');
  });

  it('should map Git to version_control', () => {
    expect(CATEGORY_MAP['Git']).toBe('version_control');
  });
});
