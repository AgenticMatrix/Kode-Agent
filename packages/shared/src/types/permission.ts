/**
 * Permission types — the three-tier permission system.
 *
 * Three-tier permission model (Plan / Ask / Auto) with risk-level-based decisions.
 * Enhanced with automatic mode classification.
 */

// ---------------------------------------------------------------------------
// Permission Mode
// ---------------------------------------------------------------------------

/**
 * The three permission modes controlling how tools are approved.
 *
 * - **Plan**: Read-only — only SAFE-risk tools are allowed. Good for exploration.
 * - **Ask**: Interactive — MUTATION tools require user confirmation.
 * - **Auto**: Automatic — non-destructive tools are auto-approved if CWD is trusted.
 */
export enum PermissionMode {
  PLAN = 'plan',
  ASK = 'ask',
  AUTO = 'auto',
}

// ---------------------------------------------------------------------------
// Risk Level
// ---------------------------------------------------------------------------

/**
 * Risk classification for tool operations.
 *
 * - **Safe**: Read-only operations — no side effects (Read, Glob, Grep, WebSearch).
 * - **Mutation**: Modifies files or executes commands — reversible with Git (Write, Edit, Bash, Git).
 * - **Destructive**: Irreversible or dangerous — always requires confirmation (rm -rf, git push --force, curl | bash).
 */
export enum RiskLevel {
  SAFE = 'safe',
  MUTATION = 'mutation',
  DESTRUCTIVE = 'destructive',
}

// ---------------------------------------------------------------------------
// Permission Check Result
// ---------------------------------------------------------------------------

export interface PermissionCheck {
  /** The tool being checked */
  toolName: string;
  /** The raw tool input */
  input: unknown;
  /** Risk level from the tool definition */
  riskLevel: RiskLevel;
}

export interface PermissionResult {
  /** Whether the tool is allowed to proceed */
  allowed: boolean;
  /** If denied, the reason for display */
  reason?: string;
  /** The behavior: approved, denied, or requires-user-input */
  behavior: 'approve' | 'deny' | 'ask_user';
  /** For 'ask_user' behavior: the question to present */
  prompt?: string;
}

// ---------------------------------------------------------------------------
// Permission Decision Logic
// ---------------------------------------------------------------------------

/**
 * Determine whether a tool requires approval based on risk level, permission mode,
 * and optional fine-grained classification.
 *
 * Rules:
 *   - PLAN mode: only SAFE tools are auto-approved
 *   - ASK mode: SAFE tools auto-approved, MUTATION/DESTRUCTIVE require confirmation
 *   - AUTO mode: non-DESTRUCTIVE tools auto-approved (if CWD is trusted)
 *   - DESTRUCTIVE risk: ALWAYS requires confirmation, regardless of mode
 */
export function requiresApproval(
  riskLevel: RiskLevel,
  mode: PermissionMode,
  isTrustedDirectory: boolean = false,
): boolean {
  // Destructive operations always require confirmation
  if (riskLevel === RiskLevel.DESTRUCTIVE) {
    return true;
  }

  switch (mode) {
    case PermissionMode.PLAN:
      // Plan mode: only safe read operations
      return riskLevel !== RiskLevel.SAFE;

    case PermissionMode.AUTO:
      // Auto mode: auto-approve non-destructive in trusted directories
      if (isTrustedDirectory) {
        return false;
      }
      // Untrusted directory: treat as ASK mode
      return riskLevel !== RiskLevel.SAFE;

    case PermissionMode.ASK:
    default:
      // Ask mode: safe operations auto-approved, rest need confirmation
      return riskLevel !== RiskLevel.SAFE;
  }
}

// ---------------------------------------------------------------------------
// Permission Engine Interface
// ---------------------------------------------------------------------------

export interface PermissionEngineLike {
  /** Check if a tool operation is allowed */
  check(check: PermissionCheck): Promise<PermissionResult>;

  /** Get the current permission mode */
  getMode(): PermissionMode;

  /** Update the permission mode at runtime */
  setMode(mode: PermissionMode): void;

  /** Check if a directory is trusted */
  isTrustedDirectory(cwd: string): boolean;

  /** Add a directory to the trusted list */
  addTrustedDirectory(path: string): void;
}

// ---------------------------------------------------------------------------
// Auto Mode Classifier (from CodeWhale)
// ---------------------------------------------------------------------------

export interface AutoModeClassifier {
  /**
   * Classify a task to determine the appropriate permission mode.
   *
   * Returns:
   *   - 'plan': Simple exploration into codebase — PLAN mode
   *   - 'ask':  Moderate changes, needs user oversight — ASK mode
   *   - 'auto': Well-scoped task in trusted directory — AUTO mode
   */
  classify(task: string, context: ClassificationContext): PermissionMode;
}

export interface ClassificationContext {
  cwd: string;
  isTrusted: boolean;
  filesInScope: number;
  hasDestructivePattern: boolean;
}
