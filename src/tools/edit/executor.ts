import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ToolExecutor } from '../types.js';

export const execute: ToolExecutor = async (input, opts) => {
  if (!opts.allowMutation) {
    return { content: 'Error: edit tool is not available (mutation tools disabled)', isError: true };
  }

  const filePath = input.file_path as string;
  const oldStr = input.old_string as string;
  const newStr = input.new_string as string;
  const replaceAll = input.replace_all as boolean;

  if (!filePath || !oldStr || newStr === undefined) {
    return { content: 'Error: file_path, old_string, and new_string are required', isError: true };
  }

  try {
    const fullPath = resolve(opts.cwd, filePath);
    let fileContent = readFileSync(fullPath, 'utf-8');

    if (!fileContent.includes(oldStr)) {
      return { content: `Error: old_string not found in ${filePath}`, isError: true };
    }

    if (replaceAll) {
      fileContent = fileContent.split(oldStr).join(newStr);
    } else {
      fileContent = fileContent.replace(oldStr, newStr);
    }

    writeFileSync(fullPath, fileContent, 'utf-8');
    return { content: `File edited: ${filePath}`, isError: false };
  } catch (err) {
    return { content: `Error editing file: ${(err as Error).message}`, isError: true };
  }
};
