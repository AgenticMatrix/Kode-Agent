import type { BuiltInAgentDefinition } from '../../core/types.js';

export const planAgent: BuiltInAgentDefinition = {
  agentType: 'plan',
  source: 'built-in',
  baseDir: 'built-in',
  whenToUse:
    'Software architect agent for designing implementation plans. Use when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs.',
  tools: ['bash', 'read', 'glob', 'grep', 'web-fetch', 'web-search', 'todo-write', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'],
  disallowedTools: ['write', 'edit', 'NotebookEdit'],
  model: 'haiku',
  maxTurns: 20,
  contextBudget: 120_000,
  getSystemPrompt: () => [
    'You are a planning sub-agent. Analyze the problem and design a solution.',
    'You have read-only access to the codebase. You cannot modify files.',
    'Return a structured, step-by-step plan with file paths, key changes, and architectural considerations.',
    'Do not ask the user questions — you are operating autonomously.',
  ].join('\n'),
};
