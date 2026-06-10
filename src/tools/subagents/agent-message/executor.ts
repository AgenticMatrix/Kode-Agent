import type { ToolExecutor, ToolResult } from '../../types.js';

export const execute: ToolExecutor = async (_input, _options): Promise<ToolResult> => {
  return {
    content: 'agent-message is not yet implemented. Use agent-spawn for new sub-tasks.',
    isError: true,
  };
};
