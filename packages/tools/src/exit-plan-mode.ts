/**
 * ExitPlanModeTool — Switch from PLAN to ASK permission mode
 *
 * In PLAN mode, only SAFE (read-only) tools are allowed. When the agent has
 * finished exploring and is ready to make changes, it calls ExitPlanMode to
 * signal the transition to ASK mode, which allows MUTATION tools with user
 * confirmation.
 *
 * Implementation: writes a marker file that the PermissionEngine checks.
 * The QueryEngine detects the marker and emits a mode_change event.
 *
 * Risk: SAFE — only writes a marker file, no destructive operations.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  BaseTool,
  RiskLevel,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
} from '@kode/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExitPlanModeInput {
  /**
   * The new permission mode. Defaults to 'ask'.
   * In the future may support 'auto' as well.
   */
  mode?: 'ask' | 'auto';
}

export interface ExitPlanModeOutput {
  previousMode: 'plan';
  newMode: 'ask' | 'auto';
  message: string;
}

// ---------------------------------------------------------------------------
// Marker file helper
// ---------------------------------------------------------------------------

/**
 * Path to the plan-exit marker file for a session.
 * The PermissionEngine checks for this file to detect mode transitions.
 */
export function getExitPlanMarkerPath(sessionId: string): string {
  const dir = join(homedir(), '.kode', 'sessions', sessionId);
  return join(dir, '.exit_plan_mode');
}

/**
 * Check if the exit-plan marker exists (called by PermissionEngine/QueryEngine).
 */
export function hasExitedPlanMode(sessionId: string): boolean {
  return existsSync(getExitPlanMarkerPath(sessionId));
}

/**
 * Read and clear the exit-plan marker. Returns the target mode or null.
 * The marker is deleted after reading to avoid repeated mode changes.
 */
export function consumeExitPlanMarker(sessionId: string): 'ask' | 'auto' | null {
  const markerPath = getExitPlanMarkerPath(sessionId);
  if (!existsSync(markerPath)) return null;

  try {
    const content = JSON.parse(
      readFileSync(markerPath, 'utf-8'),
    ) as { mode: string };
    unlinkSync(markerPath);
    if (content.mode === 'ask' || content.mode === 'auto') {
      return content.mode;
    }
    return 'ask';
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ExitPlanModeTool
// ---------------------------------------------------------------------------

const EXIT_PLAN_MODE_DESCRIPTION = `Exit PLAN mode and switch to a mode that allows making changes.

In PLAN mode, only read-only (SAFE) tools are available. Call this tool when
you have finished exploration and are ready to make code changes or run commands.

After calling this tool:
- ASK mode: Mutation tools require user confirmation before executing.
- Auto mode: Non-destructive tools are auto-approved in trusted directories.

Default transition is PLAN → ASK for safety.`;

export class ExitPlanModeTool extends BaseTool<ExitPlanModeInput, ExitPlanModeOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'ExitPlanMode',
      description: EXIT_PLAN_MODE_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['ask', 'auto'],
            description: 'Target permission mode (default: "ask")',
          },
        },
        required: [],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.SAFE,
    };
  }

  override validate(input: unknown): ValidationResult {
    if (input === null || input === undefined || typeof input !== 'object') {
      return { valid: true }; // Empty input is fine
    }
    const typed = input as Record<string, unknown>;

    if (typed.mode !== undefined) {
      if (typed.mode !== 'ask' && typed.mode !== 'auto') {
        return {
          valid: false,
          errors: [{ path: 'mode', message: 'mode must be "ask" or "auto"' }],
        };
      }
    }

    return { valid: true };
  }

  override async execute(
    input: ExitPlanModeInput,
    ctx: ToolContext,
  ): Promise<ExitPlanModeOutput> {
    const targetMode = input.mode ?? 'ask';

    // Ensure the session directory exists
    const sessionDir = join(homedir(), '.kode', 'sessions', ctx.sessionId);
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }

    // Write the marker file — PermissionEngine reads it on next check
    const markerPath = getExitPlanMarkerPath(ctx.sessionId);
    writeFileSync(
      markerPath,
      JSON.stringify({ mode: targetMode, timestamp: new Date().toISOString() }),
      'utf-8',
    );

    return {
      previousMode: 'plan',
      newMode: targetMode,
      message:
        `Exited PLAN mode. Now in ${targetMode.toUpperCase()} mode. ` +
        (targetMode === 'ask'
          ? 'You can now use mutation tools — each will require user confirmation.'
          : 'Non-destructive tools will run automatically in trusted directories.'),
    };
  }

  override formatOutput(result: ExitPlanModeOutput): string {
    return `Plan mode → ${result.newMode.toUpperCase()} mode. ${result.message}`;
  }
}
