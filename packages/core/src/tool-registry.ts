/**
 * tool-registry.ts — ToolRegistry: register, discover, getDefinitions
 *
 * Manages tool registration and discovery. Tools are registered by their
 * class instance and can be queried by name, category, or risk level.
 *
 * Tool registry for managing agent tools.
 * Architecture reference: ARCHITECTURE.md §4.6
 */

import {
  BaseTool,
  RiskLevel,
  type ToolDefinition,
  type ToolContext,
  type ToolExecutionResult,
} from '@coder/shared';

// ---------------------------------------------------------------------------
// Tool Registry
// ---------------------------------------------------------------------------

export interface ToolEntry {
  definition: ToolDefinition;
  instance: BaseTool;
}

export type ToolCategory =
  | 'file_system'
  | 'search'
  | 'shell'
  | 'version_control'
  | 'task_management'
  | 'browser'
  | 'agent'
  | 'system';

export const CATEGORY_MAP: Record<string, ToolCategory> = {
  Read: 'file_system',
  Write: 'file_system',
  Edit: 'file_system',
  Glob: 'file_system',
  Grep: 'search',
  Bash: 'shell',
  Git: 'version_control',
  TodoWrite: 'task_management',
  TaskCreate: 'task_management',
  TaskUpdate: 'task_management',
  TaskDescribe: 'task_management',
  WebFetch: 'browser',
  WebSearch: 'browser',
  AgentSpawn: 'agent',
  AgentMessage: 'agent',
  AgentStop: 'agent',
  Skill: 'system',
  MCPClient: 'system',
  TeamCreate: 'task_management',
  TeamDelete: 'task_management',
  NotebookEdit: 'file_system',
  LSP: 'system',
  ExitPlanMode: 'system',
};

export class ToolRegistry {
  private tools: Map<string, ToolEntry> = new Map();

  register(tool: BaseTool): void {
    const def = tool.definition;
    if (this.tools.has(def.name)) {
      throw new Error(`Tool already registered: ${def.name}`);
    }
    this.tools.set(def.name, { definition: def, instance: tool });
  }

  registerAll(tools: BaseTool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): ToolEntry | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolEntry[] {
    return Array.from(this.tools.values());
  }

  getDefinitions(): ToolDefinition[] {
    return this.getAll().map((entry) => entry.definition);
  }

  getDefinitionsForMode(mode: 'plan' | 'ask' | 'auto'): ToolDefinition[] {
    return this.getDefinitions().filter((def) => {
      if (mode === 'plan') {
        return def.riskLevel === RiskLevel.SAFE;
      }
      return true;
    });
  }

  getByCategory(category: ToolCategory): ToolEntry[] {
    return this.getAll().filter(
      (entry) => CATEGORY_MAP[entry.definition.name] === category,
    );
  }

  getByRiskLevel(level: RiskLevel): ToolEntry[] {
    return this.getAll().filter((entry) => entry.definition.riskLevel === level);
  }

  async execute(
    name: string,
    input: unknown,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> {
    const entry = this.tools.get(name);
    if (!entry) {
      return {
        success: false,
        error: `Unknown tool: ${name}`,
        durationMs: 0,
      };
    }
    return entry.instance.run(input, ctx);
  }

  get size(): number {
    return this.tools.size;
  }

  [Symbol.iterator](): IterableIterator<ToolEntry> {
    return this.tools.values();
  }
}
