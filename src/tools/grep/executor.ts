import { execSync } from 'node:child_process';
import type { ToolExecutor } from '../types.js';

export const execute: ToolExecutor = async (input, opts) => {
  const pattern = input.pattern as string;
  const searchPath = (input.path as string) ?? opts.cwd;
  const globPattern = input.glob as string | undefined;
  const outputMode = (input.output_mode as string) ?? 'files_with_matches';

  if (!pattern) return { content: 'Error: pattern is required', isError: true };

  const args: string[] = ['--no-heading', '--line-number', '--color=never'];
  if (globPattern) args.push('--glob', globPattern);
  if (outputMode === 'files_with_matches') args.push('-l');
  else if (outputMode === 'count') args.push('-c');

  const argsStr = args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(' ');
  const cmd = `rg ${argsStr} "${pattern.replace(/"/g, '\\"')}" "${searchPath}"`;

  try {
    const output = execSync(cmd, {
      cwd: opts.cwd,
      timeout: 30_000,
      maxBuffer: opts.maxOutput,
      encoding: 'utf-8',
    });
    const trimmed = output.trim();
    if (trimmed.length > opts.maxOutput) {
      return {
        content: trimmed.slice(0, opts.maxOutput) + '\n... (output truncated)',
        isError: false,
      };
    }
    return { content: trimmed || '(no matches)', isError: false };
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? '';
    const stdout = (err as { stdout?: string }).stdout ?? '';
    if (stderr.includes('No such file') || stderr.includes('error')) {
      return { content: `Error: ${stderr}`, isError: true };
    }
    return { content: stdout.trim() || '(no matches)', isError: false };
  }
};
