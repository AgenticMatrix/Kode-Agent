/**
 * GitTool — Structured Git operations
 *
 * Provides structured git commands with safety checks.
 * Safe operations (status, diff, log) are SAFE risk.
 * Mutation operations (add, commit, branch, checkout) are MUTATION.
 * Destructive operations (reset --hard, push --force) are DESTRUCTIVE.
 *
 * Risk: MUTATION (varies per subcommand)
 */

import { exec } from 'node:child_process';
import {
  BaseTool,
  RiskLevel,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
} from '@coder/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GIT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_LENGTH = 4000;

const SAFE_SUBCOMMANDS = new Set(['status', 'diff', 'log', 'show', 'branch', 'tag', 'rev-parse', 'config', 'remote']);
const DESTRUCTIVE_SUBCOMMANDS = new Set(['reset', 'clean', 'push', 'rebase']);
const DESTRUCTIVE_FLAGS = ['--hard', '--force', '-f', '--delete'];

// ---------------------------------------------------------------------------
// I/O Types
// ---------------------------------------------------------------------------

export interface GitInput {
  subcommand: 'status' | 'diff' | 'log' | 'show' | 'add' | 'commit' | 'branch' | 'checkout' | 'reset' | 'remote' | 'tag' | string;
  args?: string[];
  message?: string;
  cwd?: string;
}

export interface GitOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  subcommand: string;
}

// ---------------------------------------------------------------------------
// GitTool
// ---------------------------------------------------------------------------

const GIT_DESCRIPTION = `Execute Git operations safely.

Available subcommands:
- status, diff, log, show: Read-only, always safe
- add, commit, branch, checkout, tag: Modify working tree
- reset, clean: Potentially destructive

Safety rules:
- NEVER run destructive git commands without user confirmation
- NEVER skip hooks (--no-verify, --no-gpg-sign)
- NEVER force push to main/master
- Create NEW commits, do NOT amend existing ones`;

export class GitTool extends BaseTool<GitInput, GitOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'Git',
      description: GIT_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          subcommand: {
            type: 'string',
            enum: ['status', 'diff', 'log', 'show', 'add', 'commit', 'branch', 'checkout', 'reset', 'remote', 'tag'],
            description: 'Git subcommand to execute',
          },
          args: { type: 'array', items: { type: 'string' }, description: 'Additional arguments for the subcommand' },
          message: { type: 'string', description: 'Commit message (for commit subcommand)' },
          cwd: { type: 'string', description: 'Working directory (default: session cwd)' },
        },
        required: ['subcommand'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.MUTATION,
      requiresApproval: (input: unknown) => {
        const typed = input as GitInput;
        if (!typed?.subcommand) return true;

        // Destructive subcommands always require approval
        if (DESTRUCTIVE_SUBCOMMANDS.has(typed.subcommand)) return true;

        // Check args for destructive flags
        if (typed.args) {
          for (const arg of typed.args) {
            if (DESTRUCTIVE_FLAGS.some((f) => arg === f || arg.startsWith(f + '='))) {
              return true;
            }
          }
        }

        return false;
      },
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as GitInput;
    if (!typed || typeof typed !== 'object') {
      return { valid: false, errors: [{ path: '', message: 'Input must be an object' }] };
    }
    if (typeof typed.subcommand !== 'string' || typed.subcommand.trim().length === 0) {
      return { valid: false, errors: [{ path: 'subcommand', message: 'subcommand must be a non-empty string' }] };
    }
    return { valid: true };
  }

  override async execute(input: GitInput, ctx: ToolContext): Promise<GitOutput> {
    const cwd = input.cwd ?? ctx.cwd;
    const args = input.args ?? [];

    const cmdParts = ['git', input.subcommand, ...args];

    // Handle commit message separately
    if (input.subcommand === 'commit' && input.message) {
      cmdParts.push('-m', input.message);
    }

    const command = cmdParts.join(' ');

    return new Promise((resolve, reject) => {
      exec(command, {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 5 * 1024 * 1024,
        env: { ...(ctx.env ?? process.env) },
      }, (error, stdout, stderr) => {
        let output = stdout;
        if (output.length > MAX_OUTPUT_LENGTH) {
          output = output.slice(0, MAX_OUTPUT_LENGTH) + '\n[output truncated]';
        }

        resolve({
          stdout: output.trimEnd(),
          stderr: stderr.trimEnd(),
          exitCode: error?.code ?? (error ? 1 : 0),
          subcommand: input.subcommand,
        });
      });
    });
  }

  override formatOutput(result: GitOutput): string {
    const parts: string[] = [];
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(`[stderr]\n${result.stderr}`);
    if (result.exitCode !== 0) parts.push(`[Git exited with code: ${result.exitCode}]`);
    return parts.join('\n') || `Git ${result.subcommand}: done`;
  }
}
