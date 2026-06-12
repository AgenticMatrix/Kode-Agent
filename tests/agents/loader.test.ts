import { describe, expect, it } from 'vitest';
import {
  parseAgentFromMarkdown,
  parseAgentFromJson,
  getActiveAgents,
} from '../../src/agents/loader.js';
import type { AgentDefinition } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Markdown parsing
// ---------------------------------------------------------------------------

describe('parseAgentFromMarkdown', () => {
  it('should parse a minimal markdown agent definition', () => {
    const md = [
      '---',
      'name: my-agent',
      'description: Does custom things',
      '---',
      'You are a custom agent.',
    ].join('\n');

    const agent = parseAgentFromMarkdown('test.md', md, 'projectSettings');
    expect(agent).not.toBeNull();
    expect(agent!.agentType).toBe('my-agent');
    expect(agent!.whenToUse).toBe('Does custom things');
    expect(agent!.getSystemPrompt()).toBe('You are a custom agent.');
    expect(agent!.source).toBe('projectSettings');
    expect(agent!.filename).toBe('test');
  });

  it('should return null when name is missing', () => {
    const md = [
      '---',
      'description: No name here',
      '---',
      'Body.',
    ].join('\n');

    expect(parseAgentFromMarkdown('test.md', md, 'userSettings')).toBeNull();
  });

  it('should return null when description is missing', () => {
    const md = [
      '---',
      'name: nameless',
      '---',
      'Body.',
    ].join('\n');

    expect(parseAgentFromMarkdown('test.md', md, 'userSettings')).toBeNull();
  });

  it('should parse tools as a YAML array', () => {
    const md = [
      '---',
      'name: reader',
      'description: Read-only agent',
      'tools:',
      '  - bash',
      '  - read',
      '  - glob',
      '---',
      'Read-only system prompt.',
    ].join('\n');

    const agent = parseAgentFromMarkdown('reader.md', md, 'projectSettings');
    expect(agent).not.toBeNull();
    expect(agent!.tools).toEqual(['bash', 'read', 'glob']);
  });

  it('should parse tools as a comma-separated string', () => {
    const md = [
      '---',
      'name: simple',
      'description: Simple agent',
      'tools: bash, read, glob',
      '---',
      'Prompt.',
    ].join('\n');

    const agent = parseAgentFromMarkdown('simple.md', md, 'projectSettings');
    expect(agent).not.toBeNull();
    expect(agent!.tools).toEqual(['bash', 'read', 'glob']);
  });

  it('should parse optional fields', () => {
    const md = [
      '---',
      'name: full',
      'description: Full featured agent',
      'model: haiku',
      'permissionMode: auto',
      'maxTurns: 5',
      'skills:',
      '  - code-review',
      'background: true',
      'isolation: worktree',
      'color: blue',
      'initialPrompt: Start by reading CLAUDE.md.',
      '---',
      'Full prompt.',
    ].join('\n');

    const agent = parseAgentFromMarkdown('full.md', md, 'userSettings');
    expect(agent).not.toBeNull();
    expect(agent!.model).toBe('haiku');
    expect(agent!.permissionMode).toBe('auto');
    expect(agent!.maxTurns).toBe(5);
    expect(agent!.skills).toEqual(['code-review']);
    expect(agent!.background).toBe(true);
    expect(agent!.isolation).toBe('worktree');
    expect(agent!.color).toBe('blue');
    expect(agent!.initialPrompt).toBe('Start by reading CLAUDE.md.');
  });

  it('should unescape newlines in description', () => {
    const md = [
      '---',
      'name: multi',
      'description: "Line 1\\nLine 2"',
      '---',
      'Prompt.',
    ].join('\n');

    const agent = parseAgentFromMarkdown('multi.md', md, 'projectSettings');
    expect(agent!.whenToUse).toBe('Line 1\nLine 2');
  });
});

// ---------------------------------------------------------------------------
// JSON parsing
// ---------------------------------------------------------------------------

describe('parseAgentFromJson', () => {
  it('should parse a minimal JSON agent', () => {
    const agent = parseAgentFromJson(
      'json-agent',
      { description: 'A JSON agent', prompt: 'You are a JSON agent.' },
      'userSettings',
    );

    expect(agent).not.toBeNull();
    expect(agent!.agentType).toBe('json-agent');
    expect(agent!.whenToUse).toBe('A JSON agent');
    expect(agent!.getSystemPrompt()).toBe('You are a JSON agent.');
    expect(agent!.source).toBe('userSettings');
  });

  it('should return null when description is missing', () => {
    const agent = parseAgentFromJson(
      'bad',
      { prompt: 'No description' },
      'userSettings',
    );
    expect(agent).toBeNull();
  });

  it('should return null when prompt is missing', () => {
    const agent = parseAgentFromJson(
      'bad',
      { description: 'No prompt' },
      'userSettings',
    );
    expect(agent).toBeNull();
  });

  it('should parse tools and other optional fields', () => {
    const agent = parseAgentFromJson(
      'featured',
      {
        description: 'Featured agent',
        prompt: 'System prompt.',
        tools: ['bash', 'read'],
        disallowedTools: ['write'],
        skills: ['linter'],
        model: 'sonnet',
        maxTurns: 10,
        background: true,
        color: 'green',
      },
      'projectSettings',
    );

    expect(agent).not.toBeNull();
    expect(agent!.tools).toEqual(['bash', 'read']);
    expect(agent!.disallowedTools).toEqual(['write']);
    expect(agent!.skills).toEqual(['linter']);
    expect(agent!.model).toBe('sonnet');
    expect(agent!.maxTurns).toBe(10);
    expect(agent!.background).toBe(true);
    expect(agent!.color).toBe('green');
  });
});

// ---------------------------------------------------------------------------
// Priority-based deduplication
// ---------------------------------------------------------------------------

describe('getActiveAgents', () => {
  function makeAgent(
    agentType: string,
    source: AgentDefinition['source'] = 'built-in',
    whenToUse = 'test',
  ): AgentDefinition {
    return { agentType, whenToUse, getSystemPrompt: () => '', source };
  }

  it('should return all agents when no duplicates', () => {
    const result = getActiveAgents([
      makeAgent('explore', 'built-in'),
      makeAgent('plan', 'built-in'),
      makeAgent('custom', 'projectSettings'),
    ]);
    expect(result).toHaveLength(3);
  });

  it('should deduplicate by agentType keeping highest priority', () => {
    const result = getActiveAgents([
      makeAgent('explore', 'built-in', 'built-in v1'),
      makeAgent('explore', 'projectSettings', 'project override'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe('projectSettings');
    expect(result[0]!.whenToUse).toBe('project override');
  });

  it('should keep later registration when same source', () => {
    const result = getActiveAgents([
      makeAgent('custom', 'userSettings', 'first'),
      makeAgent('custom', 'userSettings', 'second'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.whenToUse).toBe('second');
  });

  it('should respect priority: built-in < plugin < userSettings < projectSettings', () => {
    const agents: AgentDefinition[] = [
      makeAgent('test', 'built-in', 'builtin'),
      makeAgent('test', 'plugin', 'plugin'),
      makeAgent('test', 'userSettings', 'user'),
      makeAgent('test', 'projectSettings', 'project'),
    ];
    const result = getActiveAgents(agents);
    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe('projectSettings');
    expect(result[0]!.whenToUse).toBe('project');
  });

  it('should handle explicit built-in source correctly', () => {
    const result = getActiveAgents([
      makeAgent('test', 'built-in', 'builtin'),
      makeAgent('test', 'userSettings', 'user'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe('userSettings');
  });
});
