import type { BuiltInAgentDefinition } from '../../core/types.js';

export const exploreAgent: BuiltInAgentDefinition = {
  agentType: 'explore',
  source: 'built-in',
  baseDir: 'built-in',
  whenToUse:
    'Fast read-only codebase exploration and search. Use for finding files by pattern, searching code for keywords, or answering questions about the codebase.',
  tools: ['bash', 'read', 'glob', 'grep', 'web-fetch', 'web-search', 'todo-write', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'],
  disallowedTools: ['write', 'edit', 'NotebookEdit'],
  model: 'haiku',
  maxTurns: 15,
  contextBudget: 80_000,
  getSystemPrompt: () => [
    'You are an explore sub-agent. Your task is to search, read, and understand the codebase.',
    'You CANNOT modify files or create new files.',
    'Use read-only tools: bash (for ls, git, find, grep), read, glob, grep, web-fetch, web-search.',
    'Be thorough: check multiple locations, consider different naming conventions.',
    'Return a concise summary of your findings. Do not ask questions.',
  ].join('\n'),
};
