import type { ToolSchema } from '../types.js';

export const schema: ToolSchema = {
  name: 'glob',
  description: 'Fast file pattern matching tool.',
  input_schema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The glob pattern to match files against',
      },
      path: {
        type: 'string',
        description: 'The directory to search in. Defaults to current working directory.',
      },
    },
    required: ['pattern'],
  },
  _meta: { riskLevel: 'safe' },
};
