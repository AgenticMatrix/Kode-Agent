import type { ToolPlugin } from '../../../tools/types.js';
import { schema } from './schema.js';
import { execute } from './executor.js';
import { TeamStatusRenderer } from './renderer.js';

const teamStatusPlugin: ToolPlugin = {
  name: 'team-status',
  schema,
  executor: execute,
  useRenderer: TeamStatusRenderer,
  paramSummary: (input) => {
    const name = input.team_name as string;
    return name ?? 'all teams';
  },
};

export default teamStatusPlugin;
