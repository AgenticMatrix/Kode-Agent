import type { ToolSchema } from '../types.js';

export const schema: ToolSchema = {
  name: 'bash',
  description:
    'Executes a given bash command and returns its output. The working directory persists between commands, but shell state does not.',
  input_schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The command to execute',
      },
      description: {
        type: 'string',
        description: 'Clear, concise description of what this command does in active voice.',
      },
      timeout: {
        type: 'integer',
        description: 'Optional timeout in milliseconds (max 600000)',
      },
      run_in_background: {
        type: 'boolean',
        description: 'Set to true to run this command in the background.',
      },
    },
    required: ['command'],
  },
  _meta: { riskLevel: 'mutation' },
};
