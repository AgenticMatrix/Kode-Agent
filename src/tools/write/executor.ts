import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ToolExecutor } from '../types.js';

export const execute: ToolExecutor = async (input, opts) => {
  if (!opts.allowMutation) {
    return { content: 'Error: write tool is not available (mutation tools disabled)', isError: true };
  }

  const filePath = input.file_path as string;
  const content = input.content as string;

  if (!filePath) return { content: 'Error: file_path is required', isError: true };
  if (content === undefined) return { content: 'Error: content is required', isError: true };

  try {
    const fullPath = resolve(opts.cwd, filePath);
    writeFileSync(fullPath, content, 'utf-8');
    return { content: `File written: ${filePath}`, isError: false };
  } catch (err) {
    return { content: `Error writing file: ${(err as Error).message}`, isError: true };
  }
};
