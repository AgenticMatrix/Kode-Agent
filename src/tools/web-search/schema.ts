import type { ToolSchema } from '../types.js';

export const schema: ToolSchema = {
  name: 'web-search',
  description: 'Search the web and use the results to inform responses.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        minLength: 2,
        description: 'The search query to use',
      },
    },
    required: ['query'],
  },
  _meta: { riskLevel: 'safe' },
};
