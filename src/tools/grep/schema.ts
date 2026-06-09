import type { ToolSchema } from '../types.js';

export const schema: ToolSchema = {
  name: 'grep',
  description: 'A powerful search tool built on ripgrep.',
  input_schema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The regular expression pattern to search for in file contents',
      },
      path: {
        type: 'string',
        description: 'File or directory to search in. Defaults to current working directory.',
      },
      glob: {
        type: 'string',
        description: 'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}")',
      },
      output_mode: {
        type: 'string',
        enum: ['content', 'files_with_matches', 'count'],
        description:
          'Output mode: "content" shows matching lines, "files_with_matches" shows file paths (default), "count" shows match counts.',
      },
    },
    required: ['pattern'],
  },
  _meta: { riskLevel: 'safe' },
};
