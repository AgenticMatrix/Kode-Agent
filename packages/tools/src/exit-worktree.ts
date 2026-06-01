/**
 * ExitWorktreeTool — Exit and optionally clean up a git worktree
 *
 * Exits the current worktree session and returns to the original
 * working directory. Supports "keep" (preserve worktree) and
 * "remove" (delete worktree and branch).
 *
 * Risk: DESTRUCTIVE — "remove" action deletes the worktree directory
 * and its branch.
 */

import { exec } from 'node:child_process';
import { dirname } from 'node:path';
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
 * Parse git worktree list to find the main repository path and branch.
 *
 * Output format (git worktree list):
 *   /path/to/main        abc1234 [main]
 *   /path/to/worktree    def5678 [feature-branch]
 *
 * Returns { worktreePath, mainRepoPath, branch, isWorktree }
 */
async function parseWorktreeInfo(cwd: string): Promise<{
  mainRepoPath: string;
  currentWorktreePath: string;
  branch: string;
  isWorktree: boolean;
}> {
  const output = await execPromise('git worktree list', { cwd });
  const lines = output.split('\n');

  let mainRepoPath = '';
  let currentWorktreePath = '';
  let branch = '';
  let isWorktree = false;

  for (const line of lines) {
    const parts = line.split(/\s+/);
    const path = parts[0];
    if (!path) continue;

    const branchMatch = line.match(/\[([^\]]+)\]/);
    const lineBranch = (branchMatch && branchMatch[1]) ? branchMatch[1] : '';

    // The first entry in git worktree list is typically the main repo
    // (bare repository or the original checkout)
    if (!mainRepoPath && !line.includes('(detached)')) {
      mainRepoPath = path;
    }

    // Check if this line matches our current cwd
    if (path === cwd || cwd.startsWith(path + '/')) {
      currentWorktreePath = path;
      branch = lineBranch;
      // If it's not the first entry (main repo), it's a worktree
      if (path !== mainRepoPath) {
        isWorktree = true;
      }
    }
  }

  // If we couldn't determine the main repo from the first line,
  // use the parent directory of the worktree
  if (isWorktree && currentWorktreePath) {
    // The main repo is the one NOT matching our cwd
    for (const line of lines) {
      const parts = line.split(/\s+/);
      const path = parts[0];
      if (path && path !== currentWorktreePath) {
        mainRepoPath = path;
        break;
      }
    }
  }

  return { mainRepoPath, currentWorktreePath, branch, isWorktree };
}

// ---------------------------------------------------------------------------
// Input / Output Types
// ---------------------------------------------------------------------------

export interface ExitWorktreeInput {
  /**
   * "keep" — exit the worktree but leave it on disk (preserve branch + files).
   * "remove" — delete the worktree directory and its branch.
   */
  action: 'keep' | 'remove';
  /**
   * Only meaningful with action "remove". Set to true to discard uncommitted
   * changes and force-remove the worktree. If false (default) and the worktree
   * has uncommitted changes, the tool will refuse to remove it.
   */
  discard_changes?: boolean;
}

export interface ExitWorktreeOutput {
  /** The action taken */
  action: 'keep' | 'remove';
  /** The absolute path to restore as the session cwd (parent repo directory) */
  originalCwd: string;
  /** The worktree path that was exited */
  worktreePath: string;
  /** The branch name of the worktree */
  branch: string;
  /** Whether the worktree was actually a worktree (vs already at main repo) */
  wasWorktree: boolean;
  /** Whether the branch was deleted (only for remove action) */
  branchDeleted?: boolean;
}

// ---------------------------------------------------------------------------
// ExitWorktreeTool
// ---------------------------------------------------------------------------

const EXIT_WORKTREE_DESCRIPTION = `Exit a worktree session created by EnterWorktree and return the session to the original working directory.

## Scope
This tool operates on worktrees created by EnterWorktree. It will NOT touch:
- Worktrees created manually with \`git worktree add\`
- Worktrees from a previous session

If called outside a worktree session, the tool is a no-op: it reports that no worktree session is active and takes no action.

## When to Use
- The user explicitly asks to "exit the worktree", "leave the worktree", "go back", or otherwise end the worktree session

## Parameters
- \`action\` (required): \`"keep"\` or \`"remove"\`
  - \`"keep"\` — leave the worktree directory and branch intact on disk. Use this if the user wants to come back to the work later, or if there are changes to preserve.
  - \`"remove"\` — delete the worktree directory and its branch. Use this for a clean exit when the work is done or abandoned.
- \`discard_changes\` (optional, default false): only meaningful with \`action: "remove"\`. If the worktree has uncommitted files or commits, the tool will REFUSE to remove it unless this is set to \`true\`.`;

export class ExitWorktreeTool extends BaseTool<ExitWorktreeInput, ExitWorktreeOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'ExitWorktree',
      description: EXIT_WORKTREE_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['keep', 'remove'],
            description:
              '"keep" leaves the worktree and branch on disk; "remove" deletes both.',
          },
          discard_changes: {
            type: 'boolean',
            description:
              'Required true when action is "remove" and the worktree has uncommitted files. The tool will refuse and list them otherwise.',
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.DESTRUCTIVE,
      requiresApproval: (input: unknown) => {
        const typed = input as ExitWorktreeInput;
        // Always require approval for destructive remove action
        if (typed?.action === 'remove') return true;
        // Keep is safe — no destruction
        return false;
      },
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as ExitWorktreeInput;
    if (!typed || typeof typed !== 'object') {
      return {
        valid: false,
        errors: [{ path: '', message: 'Input must be an object' }],
      };
    }
    if (typeof typed.action !== 'string') {
      return {
        valid: false,
        errors: [{ path: 'action', message: 'action must be a string' }],
      };
    }
    if (typed.action !== 'keep' && typed.action !== 'remove') {
      return {
        valid: false,
        errors: [{
          path: 'action',
          message: 'action must be "keep" or "remove"',
        }],
      };
    }
    if (
      typed.discard_changes !== undefined &&
      typeof typed.discard_changes !== 'boolean'
    ) {
      return {
        valid: false,
        errors: [{
          path: 'discard_changes',
          message: 'discard_changes must be a boolean',
        }],
      };
    }
    return { valid: true };
  }

  override async execute(
    input: ExitWorktreeInput,
    ctx: ToolContext,
  ): Promise<ExitWorktreeOutput> {
    let info: {
      mainRepoPath: string;
      currentWorktreePath: string;
      branch: string;
      isWorktree: boolean;
    };

    try {
      info = await parseWorktreeInfo(ctx.cwd);
    } catch {
      // Not in a git repo at all — no-op
      return {
        action: input.action,
        originalCwd: ctx.cwd,
        worktreePath: ctx.cwd,
        branch: '',
        wasWorktree: false,
      };
    }

    // If we're not in a worktree (already in the main repo), it's a no-op
    if (!info.isWorktree) {
      return {
        action: input.action,
        originalCwd: ctx.cwd,
        worktreePath: ctx.cwd,
        branch: info.branch,
        wasWorktree: false,
      };
    }

    // ── action: keep ─────────────────────────────────────────────────
    if (input.action === 'keep') {
      return {
        action: 'keep',
        originalCwd: info.mainRepoPath,
        worktreePath: info.currentWorktreePath,
        branch: info.branch,
        wasWorktree: true,
      };
    }

    // ── action: remove ───────────────────────────────────────────────
    // Check for uncommitted changes if discard_changes is not set
    if (!input.discard_changes) {
      try {
        const status = await execPromise(
          'git status --porcelain',
          { cwd: info.currentWorktreePath },
        );
        if (status.trim()) {
          const changedFiles = status
            .split('\n')
            .slice(0, 20)
            .map((l) => l.trim())
            .filter(Boolean);
          throw new Error(
            `Worktree has uncommitted changes:\n${changedFiles.join('\n')}` +
            `\n\nSet discard_changes: true to force removal, or commit/stash changes first.`,
          );
        }
      } catch (err) {
        // Re-throw our custom error; suppress other git errors
        if (err instanceof Error && err.message.includes('Worktree has uncommitted')) {
          throw err;
        }
      }
    }

    // Remove the worktree
    const forceFlag = input.discard_changes ? ' --force' : '';
    await execPromise(
      `git worktree remove "${info.currentWorktreePath}"${forceFlag}`,
      { cwd: info.mainRepoPath },
    );

    // Try to delete the branch if it still exists
    let branchDeleted = false;
    if (info.branch) {
      try {
        await execPromise(
          `git branch -D "${info.branch}"`,
          { cwd: info.mainRepoPath },
        );
        branchDeleted = true;
      } catch {
        // Branch might already be deleted or never existed as a named branch
      }
    }

    return {
      action: 'remove',
      originalCwd: info.mainRepoPath,
      worktreePath: info.currentWorktreePath,
      branch: info.branch,
      wasWorktree: true,
      branchDeleted,
    };
  }

  override formatOutput(result: ExitWorktreeOutput): string {
    if (!result.wasWorktree) {
      return 'No worktree session is active. Already at the main repository.';
    }

    if (result.action === 'keep') {
      return (
        `Exited worktree at ${result.worktreePath}\n` +
        `Return to: ${result.originalCwd}\n` +
        `Branch "${result.branch}" preserved on disk.`
      );
    }

    const branchInfo = result.branchDeleted
      ? `Branch "${result.branch}" deleted.`
      : `Worktree directory removed.`;
    return (
      `Removed worktree at ${result.worktreePath}\n` +
      `Return to: ${result.originalCwd}\n` +
      branchInfo
    );
  }
}
