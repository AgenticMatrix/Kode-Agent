import type { ToolSchema } from '../types.js';

export const schema: ToolSchema = {
  name: 'write',
  description: 'Writes a file to the local filesystem. This tool will overwrite the existing file.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to write',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file',
      },
    },
    required: ['file_path', 'content'],
  },
  _meta: { riskLevel: 'mutation' },
};
