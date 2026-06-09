import type { ToolPlugin } from '../types.js';
import { schema } from './schema.js';
import { execute } from './executor.js';
import { TaskUpdateRenderer } from './renderer.js';

const taskUpdatePlugin: ToolPlugin = {
  name: 'TaskUpdate',
  schema,
  executor: execute,
  useRenderer: TaskUpdateRenderer,
  paramSummary: (input) => {
    const taskId = input.taskId as string;
    const status = input.status as string;
    return taskId ? `#${taskId}${status ? ` → ${status}` : ''}` : undefined;
  },
};

export default taskUpdatePlugin;
