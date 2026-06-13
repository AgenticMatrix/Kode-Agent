import type { ToolPlugin } from '../../../tools/types.js';
import { schema } from './schema.js';
import { execute } from './executor.js';
import { TeamDispatchRenderer } from './renderer.js';

const teamDispatchPlugin: ToolPlugin = {
  name: 'team-dispatch',
  schema,
  executor: execute,
  useRenderer: TeamDispatchRenderer,
  paramSummary: (input) => {
    const name = input.team_name as string;
    const members = input.members as string[] | undefined;
    if (!name) return undefined;
    return members?.length ? `${name} (${members.join(', ')})` : `${name} (all pending)`;
  },
};

export default teamDispatchPlugin;
