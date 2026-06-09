import { spawn } from 'node:child_process';
import type { ToolExecutor, ToolResult } from '../types.js';

function isErrorStatus(status: number | null): boolean {
  return status !== 0;
}

function runCommand(command: string, opts: {
  cwd: string;
  timeout: number;
  maxBuffer: number;
}): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  error: Error | null;
}> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: opts.cwd,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (error: Error | null, exitCode: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, signal, error });
    };

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      // Give it a moment, then force kill
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 1000);
    }, opts.timeout);

    child.stdout?.on('data', (chunk: Buffer) => {
      const str = chunk.toString();
      if (stdout.length < opts.maxBuffer) {
        stdout += str;
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const str = chunk.toString();
      if (stderr.length < opts.maxBuffer) {
        stderr += str;
      }
    });

    child.on('error', (err) => {
      finish(err, null, null);
    });

    child.on('close', (code, sig) => {
      finish(null, code, sig);
    });
  });
}

export const execute: ToolExecutor = async (input, opts): Promise<ToolResult> => {
  if (!opts.allowMutation) {
    return { content: 'Error: bash tool is not available (mutation tools disabled)', isError: true };
  }

  const command = input.command as string;
  if (!command) return { content: 'Error: command is required', isError: true };

  const timeout = (input.timeout as number) ?? opts.bashTimeout;
  const startTime = Date.now();

  try {
    const result = await runCommand(command, {
      cwd: opts.cwd,
      timeout,
      maxBuffer: opts.maxOutput,
    });

    const duration = Date.now() - startTime;
    const stdout = result.stdout.trim();
    const stderr = result.stderr.trim();
    const exitCode = result.exitCode;
    const error = result.error;
    const timedOut = result.signal === 'SIGTERM' && result.exitCode === null;

    if (error) {
      return {
        content: `Error: ${error.message}`,
        isError: true,
        duration,
        metadata: { command, exitCode, stderr: stderr || undefined },
      };
    }

    if (timedOut) {
      return {
        content: `Error: command timed out after ${timeout}ms`,
        isError: true,
        duration,
        metadata: { command, exitCode, stderr: stderr || undefined, timedOut: true },
      };
    }

    return {
      content: stdout || (isErrorStatus(exitCode) ? '(command produced no output)' : ''),
      isError: isErrorStatus(exitCode),
      duration,
      metadata: {
        command,
        exitCode: exitCode ?? null,
        stderr: stderr || undefined,
      },
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    return {
      content: `Error: ${(err as Error).message}`,
      isError: true,
      duration,
      metadata: { command },
    };
  }
};
