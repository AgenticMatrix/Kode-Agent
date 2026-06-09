import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ToolExecutor } from '../types.js';

export const execute: ToolExecutor = async (input, opts) => {
  const filePath = input.file_path as string;
  const offset = (input.offset as number) ?? undefined;
  const limit = (input.limit as number) ?? undefined;

  if (!filePath) return { content: 'Error: file_path is required', isError: true };

  const startTime = Date.now();

  try {
    const fullPath = resolve(opts.cwd, filePath);
    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    const startLine = offset ? offset - 1 : 0;
    const endLine = limit ? startLine + limit : lines.length;
    const result = lines.slice(startLine, endLine).join('\n');
    const duration = Date.now() - startTime;

    if (result.length > opts.maxOutput) {
      return {
        content: result.slice(0, opts.maxOutput) + '\n... (output truncated)',
        isError: false,
        duration,
        metadata: { filePath },
      };
    }
    return { content: result, isError: false, duration, metadata: { filePath } };
  } catch (err) {
    const duration = Date.now() - startTime;
    return {
      content: `Error reading file: ${(err as Error).message}`,
      isError: true,
      duration,
      metadata: { filePath },
    };
  }
};
