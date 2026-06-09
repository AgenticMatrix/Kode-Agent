/**
 * PermissionEngine — Simplified Plan / Ask / Auto permission system.
 *
 * In AUTO mode everything is auto-approved.
 * In PLAN mode, only SAFE operations are approved; everything else is denied.
 * In ASK mode, SAFE operations are approved; everything else requires user confirmation.
 */

import { PermissionMode, RiskLevel, type ToolDefinition } from './types.js';

export interface PermissionCheck {
  toolName: string;
  input: Record<string, unknown>;
  riskLevel: RiskLevel;
}

export interface PermissionResult {
  allowed: boolean;
  behavior: 'approve' | 'deny' | 'ask_user';
  reason?: string;
  prompt?: string;
}

export class PermissionEngine {
  private mode: PermissionMode = PermissionMode.AUTO;
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  setCwd(cwd: string): void {
    this.cwd = cwd;
  }

  async check(permission: PermissionCheck, _toolDef?: ToolDefinition): Promise<PermissionResult> {
    // AUTO mode: auto-approve everything
    if (this.mode === PermissionMode.AUTO) {
      return { allowed: true, behavior: 'approve' };
    }
    // PLAN mode: approve safe, deny mutation/destructive
    if (this.mode === PermissionMode.PLAN) {
      if (permission.riskLevel === RiskLevel.SAFE) {
        return { allowed: true, behavior: 'approve' };
      }
      return { allowed: false, behavior: 'deny', reason: `Plan mode: ${permission.toolName} requires approval` };
    }
    // ASK mode: approve safe, ask for everything else
    if (this.mode === PermissionMode.ASK) {
      if (permission.riskLevel === RiskLevel.SAFE) {
        return { allowed: true, behavior: 'approve' };
      }
      return { allowed: false, behavior: 'ask_user', reason: `Ask mode: ${permission.toolName} requires approval`, prompt: `Allow ${permission.toolName}?` };
    }
    return { allowed: true, behavior: 'approve' };
  }
}
