import { describe, expect, it } from 'vitest';
import { filterToolsForAgent, ALL_AGENT_DISALLOWED_TOOLS } from '../../src/subagents/tool-filtering.js';
import type { ToolDefinition } from '../../src/core/types.js';

function td(name: string): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    input_schema: { type: 'object', properties: {} },
  };
}

const ALL_TOOLS: ToolDefinition[] = [
  td('bash'), td('read'), td('write'), td('edit'), td('glob'), td('grep'),
  td('web-fetch'), td('web-search'), td('todo-write'),
  td('TaskCreate'), td('TaskUpdate'), td('TaskList'), td('TaskGet'),
  td('agent-spawn'), td('agent-message'), td('agent-stop'), td('agent-read'),
  td('ask-user-question'), td('task-output'), td('exit-plan-mode'),
];

describe('ALL_AGENT_DISALLOWED_TOOLS', () => {
  it('should include agent-spawn (prevent recursive sub-agents)', () => {
    expect(ALL_AGENT_DISALLOWED_TOOLS.has('agent-spawn')).toBe(true);
  });

  it('should include agent-message and agent-stop', () => {
    expect(ALL_AGENT_DISALLOWED_TOOLS.has('agent-message')).toBe(true);
    expect(ALL_AGENT_DISALLOWED_TOOLS.has('agent-stop')).toBe(true);
  });

  it('should include ask-user-question', () => {
    expect(ALL_AGENT_DISALLOWED_TOOLS.has('ask-user-question')).toBe(true);
  });
});

describe('filterToolsForAgent', () => {
  it('should remove disallowed tools for all agent types', () => {
    const result = filterToolsForAgent(ALL_TOOLS, 'general-purpose');
    expect(result.find(t => t.name === 'agent-spawn')).toBeUndefined();
    expect(result.find(t => t.name === 'agent-message')).toBeUndefined();
    expect(result.find(t => t.name === 'ask-user-question')).toBeUndefined();
  });

  it('should include read-only tools for general-purpose', () => {
    const result = filterToolsForAgent(ALL_TOOLS, 'general-purpose');
    expect(result.find(t => t.name === 'bash')).toBeDefined();
    expect(result.find(t => t.name === 'read')).toBeDefined();
    expect(result.find(t => t.name === 'write')).toBeDefined();
  });

  it('should restrict explore agents to whitelist only', () => {
    const result = filterToolsForAgent(ALL_TOOLS, 'explore');
    // Explore agents cannot spawn sub-agents or ask user questions
    for (const t of result) {
      expect(t.name).not.toBe('agent-spawn');
      expect(t.name).not.toBe('agent-message');
      expect(t.name).not.toBe('ask-user-question');
    }
    // But should have read/browse tools
    expect(result.find(t => t.name === 'read')).toBeDefined();
    expect(result.find(t => t.name === 'glob')).toBeDefined();
    expect(result.find(t => t.name === 'grep')).toBeDefined();
  });

  it('should allow plan agents more tools than explore', () => {
    const exploreResult = filterToolsForAgent(ALL_TOOLS, 'explore');
    const planResult = filterToolsForAgent(ALL_TOOLS, 'plan');
    expect(planResult.length).toBeGreaterThanOrEqual(exploreResult.length);
  });

  it('should handle empty input', () => {
    expect(filterToolsForAgent([], 'explore')).toHaveLength(0);
    expect(filterToolsForAgent([], 'general-purpose')).toHaveLength(0);
  });
});
