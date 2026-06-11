import type { ToolPlugin } from '../../tools/types.js';
import { schema } from './schema.js';
import { execute } from './executor.js';
import { AgentSpawnRenderer } from './renderer.js';
import { AgentSpawnResultRenderer } from './result-renderer.js';

const agentSpawnPlugin: ToolPlugin = {
  name: 'agent-spawn',
  schema,
  executor: execute,
  useRenderer: AgentSpawnRenderer,
  resultRenderer: AgentSpawnResultRenderer,
  paramSummary: (input) => {
    const prompt = input.prompt as string;
    if (!prompt) return undefined;
    return prompt.length > 60 ? prompt.slice(0, 57) + '...' : prompt;
  },
};

export default agentSpawnPlugin;
