import type { ToolPlugin } from '../types.js';
import { schema } from './schema.js';
import { execute } from './executor.js';
import { ReadRenderer } from './renderer.js';

const readPlugin: ToolPlugin = {
  name: 'read',
  schema,
  executor: execute,
  useRenderer: ReadRenderer,
  paramSummary: (input) => {
    const fp = input.file_path as string;
    if (!fp) return undefined;
    return fp.split('/').slice(-2).join('/');
  },
};

export default readPlugin;
