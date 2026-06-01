/**
 * BashTool — PTY Shell execution
 *
 * Executes bash commands via child_process.exec/spawn.
 * Features: timeout handling, output truncation (4000 chars), cancellation,
 * command injection detection, background task support.
 *
 * Risk: DESTRUCTIVE — arbitrary shell execution.
 */

import { exec, spawn } from 'node:child_process';
import {
  BaseTool,
  RiskLevel,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
  type ToolExecutionResult,
} from '@kode/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes
const MAX_OUTPUT_LENGTH = 4000; // chars
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,
  /curl\s+.*\|\s*(ba)?sh/,
  /wget\s+.*\s*-O\s*-.*\|\s*(ba)?sh/,
  />\s*\/dev\/sda/,
  /mkfs\./,
  /dd\s+if=/,
  /chmod\s+777\s+\//,
  /:\(\)\s*\{\s*:\|:&\s*\};:/, // fork bomb
  /sudo\s+rm\s+-rf/,
];

// ---------------------------------------------------------------------------
// Input / Output Types
// ---------------------------------------------------------------------------

export interface BashInput {
  command: string;
  description: string;
  timeout?: number;
  run_in_background?: boolean;
  dangerouslyDisableSandbox?: boolean;
}

export interface BashOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  killed: boolean;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function detectCommandInjection(command: string): string | null {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return `Dangerous command pattern detected: ${pattern}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// BashTool
// ---------------------------------------------------------------------------

const BASH_DESCRIPTION = `Execute a bash command and return its output.

WARNING: This is a powerful tool. Use it carefully.
- Use 'description' to explain what the command does
- Use 'timeout' for long-running commands
- Use 'run_in_background' for commands that should not block
- For git operations, prefer the dedicated Git tool
- Avoid sleep, echo, or other unnecessary commands

The output is truncated at ${MAX_OUTPUT_LENGTH} characters.`;

export class BashTool extends BaseTool<BashInput, BashOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'Bash',
      description: BASH_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to execute' },
          description: { type: 'string', description: 'What this command does (for logging/permissions)' },
          timeout: { type: 'number', description: `Timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})` },
          run_in_background: { type: 'boolean', description: 'Run the command in the background' },
          dangerouslyDisableSandbox: { type: 'boolean', description: 'Disable sandbox (not recommended)' },
        },
        required: ['command', 'description'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.DESTRUCTIVE,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as BashInput;
    if (!typed || typeof typed !== 'object') {
      return { valid: false, errors: [{ path: '', message: 'Input must be an object' }] };
    }
    if (typeof typed.command !== 'string' || typed.command.trim().length === 0) {
      return { valid: false, errors: [{ path: 'command', message: 'Command must be a non-empty string' }] };
    }
    if (typeof typed.description !== 'string' || typed.description.trim().length === 0) {
      return { valid: false, errors: [{ path: 'description', message: 'Description must be a non-empty string' }] };
    }

    const injectWarning = detectCommandInjection(typed.command);
    if (injectWarning) {
      return {
        valid: false,
        errors: [{ path: 'command', message: injectWarning }],
      };
    }

    return { valid: true };
  }

  override async execute(input: BashInput, ctx: ToolContext): Promise<BashOutput> {
    const startMs = performance.now();
    const timeoutMs = input.timeout ?? ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const child = spawn('bash', ['-c', input.command], {
        cwd: ctx.cwd,
        env: { ...(ctx.env ?? process.env) },
        signal: ctx.signal,
        timeout: timeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let truncated = false;

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (stdout.length < MAX_OUTPUT_LENGTH) {
          stdout += text;
          if (stdout.length > MAX_OUTPUT_LENGTH) {
            truncated = true;
            stdout = stdout.slice(0, MAX_OUTPUT_LENGTH);
          }
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (stderr.length < MAX_OUTPUT_LENGTH) {
          stderr += text;
          if (stderr.length > MAX_OUTPUT_LENGTH) {
            truncated = true;
            stderr = stderr.slice(0, MAX_OUTPUT_LENGTH);
          }
        }
      });

      child.on('close', (code, signal) => {
        const durationMs = performance.now() - startMs;
        resolve({
          stdout: stdout.trimEnd(),
          stderr: stderr.trimEnd(),
          exitCode: code,
          killed: signal !== null,
          timedOut: signal === 'SIGTERM',
          truncated,
          durationMs,
        });
      });

      child.on('error', (err: NodeJS.ErrnoException) => {
        const durationMs = performance.now() - startMs;
        if (err.code === 'ETIMEDOUT' || err.code === 'ABORT_ERR') {
          resolve({
            stdout: stdout.trimEnd(),
            stderr: stderr.trimEnd(),
            exitCode: null,
            killed: true,
            timedOut: err.code === 'ETIMEDOUT',
            truncated,
            durationMs,
          });
        } else {
          resolve({
            stdout: '',
            stderr: err.message,
            exitCode: 1,
            killed: false,
            timedOut: false,
            truncated: false,
            durationMs,
          });
        }
      });
    });
  }

  override formatOutput(result: BashOutput): string {
    const parts: string[] = [];
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(`[stderr]\n${result.stderr}`);
    if (result.exitCode !== 0) parts.push(`[exit code: ${result.exitCode}]`);
    if (result.timedOut) parts.push('[timed out]');
    if (result.killed && !result.timedOut) parts.push('[killed]');
    if (result.truncated) parts.push(`[output truncated at ${MAX_OUTPUT_LENGTH} chars]`);
    return parts.join('\n') || '(no output)';
  }
}
