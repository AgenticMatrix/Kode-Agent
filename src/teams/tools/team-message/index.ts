import type { ToolPlugin } from '../../../tools/types.js';
import { schema } from './schema.js';
import { execute } from './executor.js';
import { TeamMessageRenderer } from './renderer.js';

const teamMessagePlugin: ToolPlugin = {
  name: 'team-message',
  schema,
  executor: execute,
  useRenderer: TeamMessageRenderer,
  paramSummary: (input) => {
    const to = input.to as string;
    const text = input.text as string;
    if (!to) return undefined;
    const preview = text ? (text.length > 20 ? text.slice(0, 17) + '...' : text) : '';
    return to === '*' ? 'broadcast' : `→ ${to}${preview ? ': ' + preview : ''}`;
  },
};

export default teamMessagePlugin;
