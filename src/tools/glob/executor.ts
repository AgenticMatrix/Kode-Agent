import { resolve } from 'node:path';
import { walkDir } from '../shared/glob-utils.js';
import type { ToolExecutor } from '../types.js';

export const execute: ToolExecutor = async (input, opts) => {
  const pattern = input.pattern as string;
  const searchPath = (input.path as string) ?? opts.cwd;

  if (!pattern) return { content: 'Error: pattern is required', isError: true };

  try {
    const baseDir = resolve(opts.cwd, searchPath);
    const results: string[] = [];
    walkDir(baseDir, pattern, baseDir, results);
    const output = results.join('\n') || '(no matches)';

    if (output.length > opts.maxOutput) {
      return {
        content: output.slice(0, opts.maxOutput) + '\n... (output truncated)',
        isError: false,
      };
    }
    return { content: output, isError: false };
  } catch (err) {
    return { content: `Error: ${(err as Error).message}`, isError: true };
  }
};
