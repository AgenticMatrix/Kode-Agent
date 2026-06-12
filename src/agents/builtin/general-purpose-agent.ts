import type { BuiltInAgentDefinition } from '../../core/types.js';

export const generalPurposeAgent: BuiltInAgentDefinition = {
  agentType: 'general-purpose',
  source: 'built-in',
  baseDir: 'built-in',
  whenToUse:
    'General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you.',
  tools: '*',
  // agent lifecycle tools are globally disabled for all sub-agents in filterToolsForAgent
  disallowedTools: [],
  maxTurns: 20,
  contextBudget: 120_000,
  getSystemPrompt: () => [
    'You are a general-purpose sub-agent worker spawned by CoderAgent to complete a specific task.',
    'Complete the task efficiently using the tools available to you.',
    'When finished, return a concise summary of your findings and results.',
    'You CANNOT spawn additional sub-agents.',
    'Do not ask the user questions — you are operating autonomously.',
  ].join('\n'),
};
