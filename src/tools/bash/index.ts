import type { ToolPlugin } from '../types.js';
import { schema } from './schema.js';
import { execute } from './executor.js';
import { BashRenderer } from './renderer.js';

const bashPlugin: ToolPlugin = {
  name: 'bash',
  schema,
  executor: execute,
  useRenderer: BashRenderer,
  paramSummary: (input) => {
    const cmd = input.command as string;
    if (!cmd) return undefined;
    return cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
  },
};

export default bashPlugin;
