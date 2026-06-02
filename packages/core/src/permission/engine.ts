/**
 * PermissionEngine — Plan / Ask / Auto three-tier permission system
 *
 * Implements Claude Code's Plan/Ask/Auto permission model combined with
 * CodeWhale's Auto Mode Classifier and RiskLevel-based decisions.
 *
 * Architecture reference: ARCHITECTURE.md §4.4
 * Type reference: packages/shared/src/types/permission.ts
 */

import {
  PermissionMode,
  RiskLevel,
  requiresApproval as checkApproval,
  type PermissionCheck,
  type PermissionResult,
} from '@coder/shared';
import type { ToolDefinition } from '@coder/shared';

// ---------------------------------------------------------------------------
// PermissionEngine
// ---------------------------------------------------------------------------

export class PermissionEngine {
  private mode: PermissionMode = PermissionMode.ASK;
  private trustedDirectories: Set<string> = new Set();
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  /**
   * Check if a tool operation should be allowed.
   *
   * Decision flow:
   * 1. Get the tool's definition to determine its RiskLevel
   * 2. Check if the tool requires approval based on risk level and mode
   * 3. If no approval needed → auto-approve
   * 4. If approval needed → ask user (or deny in non-interactive mode)
   */
  async check(
    check: PermissionCheck,
    tool?: ToolDefinition,
  ): Promise<PermissionResult> {
    const riskLevel = tool?.riskLevel ?? check.riskLevel;

    // Use the shared requiresApproval function
    const trusted = this.isTrustedDirectory(this.cwd);
    const approvalNeeded = checkApproval(riskLevel, this.mode, trusted);

    if (!approvalNeeded) {
      return { allowed: true, behavior: 'approve' };
    }

    // In Auto mode with trusted directory, approve non-destructive
    // DESTRUCTIVE operations must always ask the user, even in AUTO+trusted
    if (this.mode === PermissionMode.AUTO && trusted && riskLevel !== RiskLevel.DESTRUCTIVE) {
      return { allowed: true, behavior: 'approve' };
    }

    // In Plan mode, deny non-SAFE
    if (this.mode === PermissionMode.PLAN) {
      return {
        allowed: false,
        behavior: 'deny',
        reason: `Tool '${check.toolName}' requires ${riskLevel} permission. Plan mode only allows SAFE operations.`,
      };
    }

    // Check fine-grained approval from tool definition
    if (tool?.requiresApproval?.(check.input) === false) {
      return { allowed: true, behavior: 'approve' };
    }

    // Need user confirmation
    return {
      allowed: false,
      behavior: 'ask_user',
      prompt: `Allow ${check.toolName}? (${riskLevel} risk)`,
    };
  }

  /**
   * Quick inline check using only risk level and mode.
   */
  needsApproval(riskLevel: RiskLevel): boolean {
    return checkApproval(riskLevel, this.mode, this.isTrustedDirectory(this.cwd));
  }

  /**
   * Get current permission mode.
   */
  getMode(): PermissionMode {
    return this.mode;
  }

  /**
   * Update permission mode at runtime.
   */
  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  /**
   * Update the working directory.
   */
  setCwd(cwd: string): void {
    this.cwd = cwd;
  }

  /**
   * Check if a directory is trusted.
   */
  isTrustedDirectory(cwd: string): boolean {
    for (const dir of this.trustedDirectories) {
      if (cwd.startsWith(dir)) return true;
    }
    return false;
  }

  /**
   * Add a directory to the trusted list.
   */
  addTrustedDirectory(path: string): void {
    this.trustedDirectories.add(path);
  }

  /**
   * Remove a directory from the trusted list.
   */
  removeTrustedDirectory(path: string): void {
    this.trustedDirectories.delete(path);
  }

  /**
   * Get all trusted directories.
   */
  getTrustedDirectories(): string[] {
    return Array.from(this.trustedDirectories);
  }
}

// ---------------------------------------------------------------------------
// Auto Mode Classifier (from CodeWhale)
// ---------------------------------------------------------------------------

export interface ClassificationContext {
  cwd: string;
  isTrusted: boolean;
  filesInScope: number;
  hasDestructivePattern: boolean;
}

/**
 * Classify a task to determine the appropriate permission mode.
 *
 * Simple heuristic-based classifier:
 * - Tasks with destructive patterns → ASK mode
 * - Tasks in trusted directories with < 20 files → AUTO mode
 * - Everything else → ASK mode
 */
export function classifyTaskMode(
  task: string,
  context: ClassificationContext,
): PermissionMode {
  const lowerTask = task.toLowerCase();

  // Check for destructive patterns
  if (
    lowerTask.includes('delete') ||
    lowerTask.includes('remove') ||
    lowerTask.includes('force push') ||
    lowerTask.includes('rm -rf') ||
    lowerTask.includes('drop table') ||
    lowerTask.includes('truncate')
  ) {
    return PermissionMode.ASK;
  }

  // Check for deployment/production patterns → ASK
  if (
    lowerTask.includes('deploy') ||
    lowerTask.includes('production') ||
    lowerTask.includes('release')
  ) {
    return PermissionMode.ASK;
  }

  // If in trusted directory with small scope → AUTO
  if (context.isTrusted && context.filesInScope < 20) {
    return PermissionMode.AUTO;
  }

  // Default: ASK
  return PermissionMode.ASK;
}
