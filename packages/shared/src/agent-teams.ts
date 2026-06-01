/**
 * agent-teams.ts — Agent Teams type system
 *
 * Defines WorkerRole, WorkerConfig, and tool-to-role mappings for the
 * Coordinator→Worker task delegation protocol.
 *
 * Architecture reference: ARCHITECTURE.md §4.3 (Sub-Agent System)
 */

// ---------------------------------------------------------------------------
// WorkerRole
// ---------------------------------------------------------------------------

/**
 * Roles available in the Agent Teams protocol.
 *
 * - **Coordinator**: Orchestrator — splits tasks, assigns to Workers,
 *   synthesizes results. Full tool access.
 * - **Explore**: Read-only code explorer — Read, Glob, Grep, WebFetch, WebSearch.
 * - **Builder**: Code author — Read, Write, Edit, Bash, Glob, Grep.
 * - **Reviewer**: Code auditor — Read, Grep, Bash (for tests/linting).
 */
export enum WorkerRole {
  Coordinator = 'coordinator',
  Explore = 'explore',
  Builder = 'builder',
  Reviewer = 'reviewer',
}

// ---------------------------------------------------------------------------
// WorkerConfig
// ---------------------------------------------------------------------------

/**
 * Configuration for a Worker sub-agent.
 *
 * `contextIsolation` is always `true` — each Worker runs in an isolated
 * SessionManager with restricted tool set.
 */
export interface WorkerConfig {
  /** Worker role (determines default tool set) */
  role: WorkerRole;
  /** Explicit tool allow-list. Overrides the role-based default when set. */
  allowedTools: string[];
  /** Maximum turns for this Worker (default: 50) */
  maxTurns: number;
  /** Model override for this Worker (default: parent model) */
  model?: string;
  /** Context isolation is always true for Workers */
  contextIsolation: true;
}

// ---------------------------------------------------------------------------
// Role-to-tool mapping
// ---------------------------------------------------------------------------

/**
 * Default tool sets for each WorkerRole.
 *
 * - **coordinator**: `["*"]` — all tools available (full delegation capability).
 * - **explore**: Read, Glob, Grep, WebFetch, WebSearch — read-only discovery.
 * - **builder**: Read, Glob, Grep, Write, Edit, Bash — authoring + execution.
 * - **reviewer**: Read, Glob, Grep, Bash — analysis + verification.
 *
 * The `"*"` wildcard for coordinator means "use the full parent tool registry
 * without restriction" (no agent recursion tools excluded as coordinator
 * needs to spawn Workers).
 */
export const ROLE_TOOLS: Record<WorkerRole, string[]> = {
  [WorkerRole.Coordinator]: ['*'],
  [WorkerRole.Explore]: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
  [WorkerRole.Builder]: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash'],
  [WorkerRole.Reviewer]: ['Read', 'Glob', 'Grep', 'Bash'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the default tool set for a given WorkerRole.
 *
 * Returns `["*"]` for Coordinator (unrestricted access).
 * Returns the role-specific tool list for other roles.
 */
export function getDefaultToolsForRole(role: WorkerRole): string[] {
  return [...ROLE_TOOLS[role]];
}

/**
 * ALL WorkerRole values excluding Coordinator (used for validation).
 */
export const WORKER_ROLES = [
  WorkerRole.Explore,
  WorkerRole.Builder,
  WorkerRole.Reviewer,
] as const;

/**
 * Check if a string is a valid WorkerRole value.
 */
export function isValidWorkerRole(value: string): value is WorkerRole {
  return Object.values(WorkerRole).includes(value as WorkerRole);
}

/**
 * Check if a WorkerRole is the Coordinator role.
 */
export function isCoordinatorRole(role: WorkerRole): boolean {
  return role === WorkerRole.Coordinator;
}
