import type { ToolSchema } from '../types.js';

export const schema: ToolSchema = {
  name: 'edit',
  description: 'Performs exact string replacements in files.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to modify',
      },
      old_string: {
        type: 'string',
        description: 'The text to replace',
      },
      new_string: {
        type: 'string',
        description: 'The text to replace it with (must be different from old_string)',
      },
      replace_all: {
        type: 'boolean',
        description: 'Replace all occurrences of old_string (default false)',
      },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  _meta: { riskLevel: 'mutation' },
};
