/**
 * team-create.ts — TeamCreate tool: create Agent Team configuration
 *
 * Creates a JSON configuration file at ~/.kode/teams/<name>.json that
 * defines a team of Worker agents with assigned roles and models.
 *
 * Architecture reference: ARCHITECTURE.md §4.3 (Sub-Agent System)
 */

import { writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
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
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TEAMS_DIR = join(homedir(), '.kode', 'teams');
const DEFAULT_MAX_TURNS = 50;
const VALID_ROLES = ['coordinator', 'explore', 'builder', 'reviewer'];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamWorkerConfig {
  role: string;
  model?: string;
  maxTurns?: number;
}

export interface TeamCreateInput {
  /** Team name (kebab-case, used as filename) */
  name: string;
  /** Human-readable team description */
  description: string;
  /** Worker agent configurations */
  workers: TeamWorkerConfig[];
  /** Optional scratchpad directory */
  scratchpadDir?: string;
}

export interface TeamCreateOutput {
  teamPath: string;
  name: string;
  description: string;
  workerCount: number;
  workers: Array<{ role: string; model: string; maxTurns: number }>;
  scratchpadDir: string;
}

export interface TeamConfig {
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  workers: TeamWorkerConfig[];
  scratchpadDir?: string;
}

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

const TEAM_CREATE_DESCRIPTION = `Create a new Agent Team configuration.

A Team defines a group of Worker agents with assigned roles that collaborate
on complex tasks under a Coordinator agent.

Roles:
- coordinator: Orchestrator with full tool access — splits tasks and synthesizes results
- explore: Read-only code explorer — search, grep, file reading
- builder: Code author — read, write, edit, shell execution
- reviewer: Code auditor — read, grep, shell for tests/linting

The team configuration is saved to ~/.kode/teams/<name>.json and can be
loaded at startup via KODE_TEAM=<name>.`;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isValidTeamName(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name) && name.length >= 2 && name.length <= 50;
}

// ---------------------------------------------------------------------------
// TeamCreateTool
// ---------------------------------------------------------------------------

export class TeamCreateTool extends BaseTool<TeamCreateInput, TeamCreateOutput> {
  private teamsDir: string;

  constructor(teamsDir?: string) {
    super();
    this.teamsDir = teamsDir ?? DEFAULT_TEAMS_DIR;
  }

  override get definition(): ToolDefinition {
    return {
      name: 'TeamCreate',
      description: TEAM_CREATE_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Team name (kebab-case, e.g. "code-review-squad")',
          },
          description: {
            type: 'string',
            description: 'Human-readable description of what this team does',
          },
          workers: {
            type: 'array',
            description: 'Worker agent configurations for this team',
            items: {
              type: 'object',
              properties: {
                role: {
                  type: 'string',
                  enum: VALID_ROLES,
                  description: 'Worker role: coordinator, explore, builder, or reviewer',
                },
                model: {
                  type: 'string',
                  description: 'Optional model override for this worker',
                },
                maxTurns: {
                  type: 'number',
                  description: 'Maximum turns for this worker (default: 50)',
                },
              },
              required: ['role'],
              additionalProperties: false,
            },
          },
          scratchpadDir: {
            type: 'string',
            description: 'Optional working directory for team scratch files',
          },
        },
        required: ['name', 'description', 'workers'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.SAFE,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as TeamCreateInput;
    if (!typed || typeof typed !== 'object') {
      return { valid: false, errors: [{ path: '', message: 'Input must be an object' }] };
    }

    if (typeof typed.name !== 'string' || !isValidTeamName(typed.name)) {
      return {
        valid: false,
        errors: [{
          path: 'name',
          message: 'Team name must be kebab-case (lowercase letters, digits, hyphens), 2-50 characters',
        }],
      };
    }

    if (typeof typed.description !== 'string' || typed.description.trim().length === 0) {
      return {
        valid: false,
        errors: [{ path: 'description', message: 'description must be a non-empty string' }],
      };
    }

    if (!Array.isArray(typed.workers) || typed.workers.length === 0) {
      return {
        valid: false,
        errors: [{ path: 'workers', message: 'workers must be a non-empty array' }],
      };
    }

    for (let i = 0; i < typed.workers.length; i++) {
      const w = typed.workers[i]!;
      if (!VALID_ROLES.includes(w.role)) {
        return {
          valid: false,
          errors: [{ path: `workers[${i}].role`, message: `Invalid role: ${w.role}. Must be one of: ${VALID_ROLES.join(', ')}` }],
        };
      }
      if (w.maxTurns !== undefined && (typeof w.maxTurns !== 'number' || w.maxTurns < 1 || w.maxTurns > 200)) {
        return {
          valid: false,
          errors: [{ path: `workers[${i}].maxTurns`, message: 'maxTurns must be between 1 and 200' }],
        };
      }
    }

    return { valid: true };
  }

  override async execute(
    input: TeamCreateInput,
    _ctx: ToolContext,
  ): Promise<TeamCreateOutput> {
    const teamPath = join(this.teamsDir, `${input.name}.json`);

    // Ensure the teams directory exists
    if (!existsSync(this.teamsDir)) {
      mkdirSync(this.teamsDir, { recursive: true });
    }

    // Check if team already exists
    if (existsSync(teamPath)) {
      throw new Error(
        `Team "${input.name}" already exists at ${teamPath}. ` +
        `Use TeamDelete to remove it first, or choose a different name.`,
      );
    }

    const now = new Date().toISOString();
    const scratchpadDir = input.scratchpadDir ?? join(homedir(), '.kode', 'scratchpad', input.name);

    const config: TeamConfig = {
      name: input.name,
      description: input.description,
      createdAt: now,
      updatedAt: now,
      workers: input.workers.map((w) => ({
        role: w.role,
        model: w.model,
        maxTurns: w.maxTurns ?? DEFAULT_MAX_TURNS,
      })),
      scratchpadDir,
    };

    // Atomic write: tmp → rename
    const tmpPath = teamPath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');

    try {
      renameSync(tmpPath, teamPath);
    } catch {
      // Clean up temp file on failure
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
      throw new Error('Failed to write team configuration');
    }

    return {
      teamPath,
      name: input.name,
      description: input.description,
      workerCount: input.workers.length,
      workers: config.workers.map((w) => ({
        role: w.role,
        model: w.model ?? 'inherited',
        maxTurns: w.maxTurns ?? DEFAULT_MAX_TURNS,
      })),
      scratchpadDir,
    };
  }

  override formatOutput(result: TeamCreateOutput): string {
    const workerLines = result.workers
      .map((w) => `  - ${w.role} (model: ${w.model}, maxTurns: ${w.maxTurns})`)
      .join('\n');

    return [
      `Team "${result.name}" created successfully.`,
      `Description: ${result.description}`,
      `Workers (${result.workerCount}):`,
      workerLines,
      `Config: ${result.teamPath}`,
      `Scratchpad: ${result.scratchpadDir}`,
    ].join('\n');
  }
}
