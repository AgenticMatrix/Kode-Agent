import type { ToolSchema } from '../types.js';

export const schema: ToolSchema = {
  name: 'read',
  description: 'Reads a file from the local filesystem.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to read',
      },
      offset: {
        type: 'integer',
        description: 'The line number to start reading from (optional)',
      },
      limit: {
        type: 'integer',
        description: 'The number of lines to read (optional)',
      },
    },
    required: ['file_path'],
  },
  _meta: { riskLevel: 'safe' },
};
