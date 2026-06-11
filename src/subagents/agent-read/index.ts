import type { ToolPlugin } from '../../tools/types.js';
import { schema } from './schema.js';
import { execute } from './executor.js';
import { AgentReadRenderer } from './renderer.js';

const agentReadPlugin: ToolPlugin = {
  name: 'agent-read',
  schema,
  executor: execute,
  useRenderer: AgentReadRenderer,
};

export default agentReadPlugin;
