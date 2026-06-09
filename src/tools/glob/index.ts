import type { ToolPlugin } from '../types.js';
import { schema } from './schema.js';
import { execute } from './executor.js';
import { GlobRenderer } from './renderer.js';

const globPlugin: ToolPlugin = {
  name: 'glob',
  schema,
  executor: execute,
  useRenderer: GlobRenderer,
  paramSummary: (input) => {
    const p = input.pattern as string;
    if (!p) return undefined;
    return p.length > 40 ? p.slice(0, 37) + '...' : p;
  },
};

export default globPlugin;
