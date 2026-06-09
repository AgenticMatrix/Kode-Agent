/**
 * ToolRegistry — Adapter bridging CoderAgent's ToolRegistry pattern
 * to ink-chat-tui's existing tools/plugins.
 *
 * Tools are registered with a definition (for the LLM) and an execute
 * function (for the agent loop). The getAnthropicTools() helper strips
 * internal metadata to produce Anthropic-compatible tool definitions.
 */

import type { ToolDefinition, ToolContext, ToolExecutionResult } from './types.js';

interface ToolRegistration {
  definition: ToolDefinition;
  execute: (input: Record<string, unknown>, context: ToolContext) => Promise<ToolExecutionResult>;
}

export class ToolRegistry {
  private tools = new Map<string, ToolRegistration>();

  register(definition: ToolDefinition, execute: ToolRegistration['execute']): void {
    this.tools.set(definition.name, { definition, execute });
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  get(name: string): ToolRegistration | undefined {
    return this.tools.get(name);
  }

  async execute(name: string, input: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: `Unknown tool: ${name}`, isError: true };
    }
    return tool.execute(input, context);
  }

  /** Get Anthropic-compatible tool definitions (strip internal metadata). */
  getAnthropicTools(): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
    return this.getDefinitions().map(({ name, description, input_schema }) => ({
      name, description, input_schema,
    }));
  }

  get names(): string[] {
    return Array.from(this.tools.keys());
  }
}
