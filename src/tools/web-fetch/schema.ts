import type { ToolSchema } from '../types.js';

export const schema: ToolSchema = {
  name: 'web-fetch',
  description: 'Fetches content from a specified URL and processes it.',
  input_schema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        format: 'uri',
        description: 'The URL to fetch content from',
      },
      prompt: {
        type: 'string',
        description: 'The prompt to run on the fetched content',
      },
    },
    required: ['url', 'prompt'],
  },
  _meta: { riskLevel: 'safe' },
};
