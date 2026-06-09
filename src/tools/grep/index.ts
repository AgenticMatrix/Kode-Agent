import type { ToolPlugin } from '../types.js';
import { schema } from './schema.js';
import { execute } from './executor.js';
import { GrepRenderer } from './renderer.js';

const grepPlugin: ToolPlugin = {
  name: 'grep',
  schema,
  executor: execute,
  useRenderer: GrepRenderer,
  paramSummary: (input) => {
    const p = input.pattern as string;
    if (!p) return undefined;
    return p.length > 40 ? p.slice(0, 37) + '...' : p;
  },
};

export default grepPlugin;
