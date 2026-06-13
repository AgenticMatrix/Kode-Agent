import type { ToolPlugin } from '../types.js';
import { schema } from './schema.js';
import { execute } from './executor.js';
import { TaskListRenderer } from './renderer.js';
import { isTodoV2Enabled } from '../../tasks/store.js';

const taskListPlugin: ToolPlugin = {
  name: 'TaskList',
  schema,
  executor: execute,
  useRenderer: TaskListRenderer,
  isEnabled: () => isTodoV2Enabled(),
  paramSummary: () => undefined,
};

export default taskListPlugin;
