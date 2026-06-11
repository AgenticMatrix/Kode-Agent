import type { ToolPlugin } from '../../tools/types.js';
import { schema } from './schema.js';
import { execute } from './executor.js';

const agentMessagePlugin: ToolPlugin = {
  name: 'agent-message',
  schema,
  executor: execute,
};

export default agentMessagePlugin;
