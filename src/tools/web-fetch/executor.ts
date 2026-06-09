import type { ToolExecutor } from '../types.js';

export const execute: ToolExecutor = async (_input, _opts) => {
  return {
    content: 'web-fetch is not yet implemented in local executor.',
    isError: true,
  };
};
