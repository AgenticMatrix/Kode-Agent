import type { ToolPlugin } from '../types.js';
import { schema } from './schema.js';
import { execute } from './executor.js';
import { EditRenderer } from './renderer.js';

const editPlugin: ToolPlugin = {
  name: 'edit',
  schema,
  executor: execute,
  useRenderer: EditRenderer,
  paramSummary: (input) => {
    const fp = input.file_path as string;
    if (!fp) return undefined;
    return fp.split('/').slice(-2).join('/');
  },
};

export default editPlugin;
