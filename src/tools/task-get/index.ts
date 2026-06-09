import type { ToolPlugin } from '../types.js';
import { schema } from './schema.js';
import { execute } from './executor.js';
import { TaskGetRenderer } from './renderer.js';

const taskGetPlugin: ToolPlugin = {
  name: 'TaskGet',
  schema,
  executor: execute,
  useRenderer: TaskGetRenderer,
  paramSummary: (input) => {
    const taskId = input.taskId as string;
    return taskId ? `#${taskId}` : undefined;
  },
};

export default taskGetPlugin;
