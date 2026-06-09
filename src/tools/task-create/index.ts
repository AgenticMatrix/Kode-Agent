import type { ToolPlugin } from '../types.js';
import { schema } from './schema.js';
import { execute } from './executor.js';
import { TaskCreateRenderer } from './renderer.js';

const taskCreatePlugin: ToolPlugin = {
  name: 'TaskCreate',
  schema,
  executor: execute,
  useRenderer: TaskCreateRenderer,
  paramSummary: (input) => {
    const subject = input.subject as string;
    if (!subject) return undefined;
    return subject.length > 50 ? subject.slice(0, 47) + '...' : subject;
  },
};

export default taskCreatePlugin;
