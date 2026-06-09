import type { ToolPlugin } from '../types.js';
import { schema } from './schema.js';
import { execute } from './executor.js';
import { TaskListRenderer } from './renderer.js';

const taskListPlugin: ToolPlugin = {
  name: 'TaskList',
  schema,
  executor: execute,
  useRenderer: TaskListRenderer,
  paramSummary: () => undefined,
};

export default taskListPlugin;
