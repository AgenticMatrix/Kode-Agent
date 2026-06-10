import type { ToolPlugin } from '../types.js';
import { schema } from './schema.js';
import { execute } from './executor.js';

const agentStopPlugin: ToolPlugin = {
  name: 'agent-stop',
  schema,
  executor: execute,
};

export default agentStopPlugin;
