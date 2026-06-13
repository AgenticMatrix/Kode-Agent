import type { ToolPlugin } from '../../../tools/types.js';
import { schema } from './schema.js';
import { execute } from './executor.js';
import { TeamCreateRenderer } from './renderer.js';

const teamCreatePlugin: ToolPlugin = {
  name: 'team-create',
  schema,
  executor: execute,
  useRenderer: TeamCreateRenderer,
  paramSummary: (input) => {
    const name = input.name as string;
    return name ? `Team: ${name}` : undefined;
  },
};

export default teamCreatePlugin;
