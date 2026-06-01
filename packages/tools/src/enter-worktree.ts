/**
 * EnterWorktreeTool — Git worktree isolation
 *
 * Creates a new git worktree in .kode/worktrees/ on a new branch,
 * or enters an existing worktree by path. The returned path should be
 * used as the cwd for subsequent tool calls.
 *
 * Risk: MUTATION — creates new git branch and working directory.
 */

import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  BaseTool,
  RiskLevel,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
} from '@kode/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GIT_TIMEOUT_MS = 30_000;
const WORKTREE_BASE_DIR = '.kode/worktrees';
const MAX_OUTPUT_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function execPromise(command: string, options: { cwd: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, {
      cwd: options.cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 5 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout.trimEnd());
      }
    });
  });
}

/**
 * Detect the default branch ref (e.g. origin/main, origin/master).
 * Falls back to HEAD if neither is found.
 */
async function getDefaultBranchRef(cwd: string): Promise<string> {
  try {
    // Try to list remote branches to find the default
    const branches = await execPromise(
      'git branch -r --format="%(refname:short)"',
      { cwd },
    );
    for (const branch of branches.split('\n')) {
      const trimmed = branch.trim();
      if (trimmed === 'origin/main' || trimmed === 'origin/master') {
        return trimmed;
      }
    }
  } catch {
    // Fall through to HEAD
  }
  return 'HEAD';
}

/**
 * Generate a random worktree name using a short UUID prefix.
 */
function generateRandomName(): string {
  return `worktree-${randomUUID().slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// Input / Output Types
// ---------------------------------------------------------------------------

export interface EnterWorktreeInput {
  /** Optional name for a new worktree. Each "/"-separated segment may contain
   *  only letters, digits, dots, underscores, and dashes; max 64 chars total.
   *  A random name is generated if not provided. Mutually exclusive with `path`. */
  name?: string;
  /** Path to an existing worktree of the current repository to enter.
   *  Must appear in `git worktree list`. Mutually exclusive with `name`. */
  path?: string;
}

export interface EnterWorktreeOutput {
  /** Absolute path to the worktree directory */
  path: string;
  /** Git branch name for the worktree */
  branch: string;
  /** Whether a new worktree was created (true) or an existing one was entered (false) */
  isNew: boolean;
  /** The action taken */
  action: 'created' | 'entered';
  /** Base ref used for new worktree creation (only set when isNew) */
  baseRef?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isValidWorktreeName(name: string): boolean {
  // Each segment: letters, digits, dots, underscores, dashes; max 64 chars total
  if (name.length === 0 || name.length > 64) return false;
  const segments = name.split('/');
  for (const seg of segments) {
    if (seg.length === 0) return false;
    if (!/^[a-zA-Z0-9._-]+$/.test(seg)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// EnterWorktreeTool
// ---------------------------------------------------------------------------

const ENTER_WORKTREE_DESCRIPTION = `Use this tool ONLY when explicitly instructed to work in a worktree — either by the user directly, or by project instructions.

Creates an isolated git worktree and switches the current session into it.

## When to Use
- The user explicitly says "worktree" (e.g., "start a worktree", "work in a worktree", "create a worktree", "use a worktree")
- Project instructions direct you to work in a worktree for the current task

## When NOT to Use
- The user asks to create a branch, switch branches, or work on a different branch — use git commands instead
- The user asks to fix a bug or work on a feature — use normal git workflow unless worktrees are explicitly requested
- Never use this tool unless "worktree" is explicitly mentioned by the user or in project instructions

## Parameters
- \`name\` (optional): A name for a new worktree. If neither \`name\` nor \`path\` is provided, a random name is generated.
- \`path\` (optional): Path to an existing worktree of the current repository to enter instead of creating one. Mutually exclusive with \`name\`.

## Behavior
- In a git repository: creates a new git worktree inside \`.kode/worktrees/\` on a new branch. The base ref defaults to origin/<default-branch> or HEAD.
- Enters an existing worktree when \`path\` is provided and it appears in \`git worktree list\`.
- Use ExitWorktree to leave the worktree mid-session (keep or remove).`;

export class EnterWorktreeTool extends BaseTool<EnterWorktreeInput, EnterWorktreeOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'EnterWorktree',
      description: ENTER_WORKTREE_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'Optional name for a new worktree. Each "/"-separated segment may contain only letters, digits, dots, underscores, and dashes; max 64 chars total. A random name is generated if not provided. Mutually exclusive with `path`.',
          },
          path: {
            type: 'string',
            description:
              'Path to an existing worktree of the current repository to enter instead of creating one. Must appear in `git worktree list` for the current repo. Mutually exclusive with `name`.',
          },
        },
        required: [],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.MUTATION,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as EnterWorktreeInput;
    if (!typed || typeof typed !== 'object') {
      return {
        valid: false,
        errors: [{ path: '', message: 'Input must be an object' }],
      };
    }

    // Validate name if provided
    if (typed.name !== undefined && typed.name !== null) {
      if (typeof typed.name !== 'string') {
        return {
          valid: false,
          errors: [{ path: 'name', message: 'name must be a string' }],
        };
      }
      if (!isValidWorktreeName(typed.name)) {
        return {
          valid: false,
          errors: [{
            path: 'name',
            message:
              'Invalid worktree name. Each segment may contain only letters, digits, dots, underscores, and dashes; max 64 chars total.',
          }],
        };
      }
    }

    // Validate path if provided
    if (typed.path !== undefined && typed.path !== null) {
      if (typeof typed.path !== 'string') {
        return {
          valid: false,
          errors: [{ path: 'path', message: 'path must be a string' }],
        };
      }
    }

    // Mutually exclusive check
    if (typed.name && typed.path) {
      return {
        valid: false,
        errors: [{
          path: '',
          message: 'name and path are mutually exclusive. Provide one or neither, not both.',
        }],
      };
    }

    return { valid: true };
  }

  override async execute(
    input: EnterWorktreeInput,
    ctx: ToolContext,
  ): Promise<EnterWorktreeOutput> {
    // ── Path provided: enter existing worktree ───────────────────────
    if (input.path) {
      const fullPath = resolve(ctx.cwd, input.path);

      // Verify the path is a registered git worktree
      const listOutput = await execPromise('git worktree list', { cwd: ctx.cwd });
      const lines = listOutput.split('\n');
      const match = lines.find((line) => {
        // git worktree list output: "/path/to/worktree HASH [branch]"
        const parts = line.split(/\s+/);
        return parts[0] === fullPath;
      });

      if (!match) {
        throw new Error(
          `Path "${fullPath}" is not a registered git worktree in this repository. ` +
          `Use \`git worktree list\` to see available worktrees.`,
        );
      }

      // Extract branch name from the worktree list line
      // Format: "/path HASH [branch]" or "/path (detached HEAD)"
      const branchMatch = match.match(/\[([^\]]+)\]/);
      const branch: string = (branchMatch && branchMatch[1]) ? branchMatch[1] : basename(fullPath);

      return {
        path: fullPath,
        branch,
        isNew: false,
        action: 'entered',
      };
    }

    // ── Create new worktree ──────────────────────────────────────────
    const name = input.name || generateRandomName();
    const baseDir = resolve(ctx.cwd, WORKTREE_BASE_DIR);
    const worktreePath = resolve(baseDir, name);

    // Ensure the base directory exists
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }

    // Check if worktree already exists
    if (existsSync(worktreePath)) {
      throw new Error(
        `Worktree path already exists: ${worktreePath}. ` +
        `Use \`path\` to enter it, or choose a different name.`,
      );
    }

    // Determine base ref
    const baseRef = await getDefaultBranchRef(ctx.cwd);

    // Create the worktree
    // Use -b to create a new branch if the baseRef is a commit/branch
    const branchName = name.replace(/\//g, '-');
    await execPromise(
      `git worktree add -b "${branchName}" "${worktreePath}" "${baseRef}"`,
      { cwd: ctx.cwd },
    );

    return {
      path: worktreePath,
      branch: branchName,
      isNew: true,
      action: 'created',
      baseRef,
    };
  }

  override formatOutput(result: EnterWorktreeOutput): string {
    if (result.isNew) {
      const refInfo = result.baseRef ? ` from ${result.baseRef}` : '';
      return `Created worktree at ${result.path}\nBranch: ${result.branch}${refInfo}`;
    }
    return `Entered existing worktree at ${result.path}\nBranch: ${result.branch}`;
  }
}
