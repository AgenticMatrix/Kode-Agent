/**
 * team-delete.ts — TeamDelete tool: remove an Agent Team configuration
 *
 * Deletes the JSON configuration file at ~/.coder/teams/<name>.json.
 * Safety check: prevents deletion of the default team.
 *
 * Architecture reference: ARCHITECTURE.md §4.3 (Sub-Agent System)
 */

import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
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

const DEFAULT_TEAMS_DIR = join(homedir(), '.coder', 'teams');
const PROTECTED_TEAMS = new Set(['default']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamDeleteInput {
  /** Team name to delete */
  name: string;
}

export interface TeamDeleteOutput {
  deleted: boolean;
  name: string;
  teamPath: string;
}

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

const TEAM_DELETE_DESCRIPTION = `Delete an Agent Team configuration.

Removes the team config file from ~/.coder/teams/. Running agents that are
part of this team are NOT affected — the deletion only prevents new agents
from being spawned with this team config.

The "default" team is protected and cannot be deleted.`;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isValidTeamName(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name) && name.length >= 2 && name.length <= 50;
}

// ---------------------------------------------------------------------------
// TeamDeleteTool
// ---------------------------------------------------------------------------

export class TeamDeleteTool extends BaseTool<TeamDeleteInput, TeamDeleteOutput> {
  private teamsDir: string;

  constructor(teamsDir?: string) {
    super();
    this.teamsDir = teamsDir ?? DEFAULT_TEAMS_DIR;
  }

  override get definition(): ToolDefinition {
    return {
      name: 'TeamDelete',
      description: TEAM_DELETE_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the team to delete',
          },
        },
        required: ['name'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.MUTATION,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as TeamDeleteInput;
    if (!typed || typeof typed !== 'object') {
      return { valid: false, errors: [{ path: '', message: 'Input must be an object' }] };
    }

    if (typeof typed.name !== 'string' || !isValidTeamName(typed.name)) {
      return {
        valid: false,
        errors: [{
          path: 'name',
          message: 'Team name must be kebab-case, 2-50 characters',
        }],
      };
    }

    return { valid: true };
  }

  override async execute(
    input: TeamDeleteInput,
    _ctx: ToolContext,
  ): Promise<TeamDeleteOutput> {
    const teamPath = join(this.teamsDir, `${input.name}.json`);

    // Safety: protect the default team
    if (PROTECTED_TEAMS.has(input.name)) {
      throw new Error(
        `Cannot delete the "${input.name}" team — it is protected. ` +
        `Protected teams: ${[...PROTECTED_TEAMS].join(', ')}`,
      );
    }

    // Check if team file exists
    if (!existsSync(teamPath)) {
      throw new Error(
        `Team "${input.name}" does not exist at ${teamPath}. ` +
        `Use TeamCreate to create it first.`,
      );
    }

    // Ensure the teams directory exists before deleting (sanity check)
    if (!existsSync(this.teamsDir)) {
      mkdirSync(this.teamsDir, { recursive: true });
      throw new Error(
        `Teams directory did not exist. Created ${this.teamsDir}. ` +
        `Team "${input.name}" was not deleted since it could not have existed.`,
      );
    }

    // Additional safety: verify the file is actually a JSON file
    if (!teamPath.endsWith('.json')) {
      throw new Error(`Safety check failed: team path does not end with .json`);
    }

    // Verify the file is within the teams directory (path traversal protection)
    const resolvedTeamPath = join(this.teamsDir, `${input.name}.json`);
    if (resolvedTeamPath !== teamPath) {
      throw new Error('Safety check failed: invalid team path');
    }

    unlinkSync(teamPath);

    return {
      deleted: true,
      name: input.name,
      teamPath,
    };
  }

  override formatOutput(result: TeamDeleteOutput): string {
    if (result.deleted) {
      return `Team "${result.name}" deleted successfully.\nConfig removed: ${result.teamPath}`;
    }
    return `Team "${result.name}" was not deleted.`;
  }
}
