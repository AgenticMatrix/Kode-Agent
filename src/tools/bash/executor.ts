import { spawn } from 'node:child_process';
import type { ToolExecutor, ToolResult } from '../types.js';

const BG_CAPTURE_MS = 3000;

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
  pid: number;
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
      resolve({ stdout, stderr, exitCode, signal, error, pid: child.pid ?? 0 });
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

/**
 * Spawn a command in background: capture output briefly, then resolve
 * WITHOUT killing the process. The process keeps running detached.
 */
function runBackgroundCommand(command: string, opts: {
  cwd: string;
  maxBuffer: number;
}): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error: Error | null;
  pid: number;
}> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: opts.cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      detached: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const capture = () => {
      if (settled) return;
      settled = true;
      // Unpipe so remaining data doesn't keep accumulating
      child.stdout?.removeAllListeners('data');
      child.stderr?.removeAllListeners('data');
      child.removeAllListeners('close');
      child.removeAllListeners('error');
      // Detach the child so it survives the parent Node process
      child.unref();
      resolve({
        stdout,
        stderr,
        exitCode: child.exitCode,
        error: null,
        pid: child.pid ?? 0,
      });
    };

    // Capture output during the window
    child.stdout?.on('data', (chunk: Buffer) => {
      const str = chunk.toString();
      if (stdout.length < opts.maxBuffer) stdout += str;
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const str = chunk.toString();
      if (stderr.length < opts.maxBuffer) stderr += str;
    });

    // If the process exits during the capture window, resolve immediately
    child.on('close', (code) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        child.stdout?.removeAllListeners('data');
        child.stderr?.removeAllListeners('data');
        child.unref();
        resolve({
          stdout,
          stderr,
          exitCode: code,
          error: null,
          pid: child.pid ?? 0,
        });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        child.unref();
        resolve({ stdout, stderr, exitCode: null, error: err, pid: 0 });
      }
    });

    // After the capture window, resolve WITHOUT killing
    const timer = setTimeout(capture, BG_CAPTURE_MS);
  });
}

export const execute: ToolExecutor = async (input, opts): Promise<ToolResult> => {
  if (!opts.allowMutation) {
    return { content: 'Error: bash tool is not available (mutation tools disabled)', isError: true };
  }

  const command = input.command as string;
  if (!command) return { content: 'Error: command is required', isError: true };

  const runInBackground = input.run_in_background as boolean | undefined;
  const timeout = (input.timeout as number) ?? opts.bashTimeout;
  const startTime = Date.now();

  try {
    if (runInBackground) {
      const result = await runBackgroundCommand(command, {
        cwd: opts.cwd,
        maxBuffer: opts.maxOutput,
      });

      const duration = Date.now() - startTime;
      const stdout = result.stdout.trim();
      const stderr = result.stderr.trim();
      const exited = result.exitCode !== null;

      if (result.error) {
        return {
          content: `Error spawning background command: ${result.error.message}`,
          isError: true,
          duration,
          metadata: { command },
        };
      }

      if (exited) {
        const output = [stdout, stderr].filter(Boolean).join('\n');
        return {
          content: output || '(no output)',
          isError: isErrorStatus(result.exitCode),
          duration,
          metadata: { command, exitCode: result.exitCode ?? null, stderr: stderr || undefined, background: true },
        };
      }

      const output = [stdout, stderr].filter(Boolean).join('\n');
      const statusLine = `Command started in background (pid ${result.pid}). Captured output after ${BG_CAPTURE_MS}ms:\n`;
      return {
        content: statusLine + (output || '(no output yet)'),
        isError: false,
        duration,
        metadata: { command, pid: result.pid, background: true },
      };
    }

    // Foreground mode: wait for completion or timeout
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