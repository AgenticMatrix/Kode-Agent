/**
 * AgentSpawnTool — Launch sub-agents for complex multi-step tasks
 *
 * Non-blocking: calls SubagentBus.spawn() which invokes the runAgent
 * callback to create a restricted QueryEngine in the background.
 * Returns agentId immediately.
 *
 * Requires SubagentBus.initialize({ runAgent }) to have been called
 * in the CLI layer before this tool is used.
 *
 * The parent agent can later:
 *  - Read transcripts via AgentRead tool
 *  - Send follow-up messages via AgentMessage tool
 *  - Cancel the sub-agent via AgentStop tool
 *
 * Risk: MUTATION — launches background computation.
 */

import {
  BaseTool,
  RiskLevel,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
} from '@kode/shared';
import {
  getSubagentBus,
  WorkerRole,
  ROLE_TOOLS,
  isValidWorkerRole,
  getDefaultToolsForRole,
} from '@kode/shared';
import type { WorkerConfig } from '@kode/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SubagentType = 'Explore' | 'general-purpose' | 'Plan';

export interface AgentSpawnInput {
  /** Short (3-5 word) description of the task */
  description: string;
  /** The task for the agent to perform */
  prompt: string;
  /** Type of specialized agent to use */
  subagent_type?: SubagentType;
  /** Maximum turns (default: 50) */
  max_turns?: number;
  /**
   * Worker role for Agent Teams protocol.
   * - "explore": Read-only discovery (Read, Glob, Grep, WebFetch, WebSearch)
   * - "builder": Code authoring (Read, Glob, Grep, Write, Edit, Bash)
   * - "reviewer": Code auditing (Read, Glob, Grep, Bash)
   *
   * When set, the worker_role determines the default tool set.
   * Use allowed_tools to override the role-based defaults.
   */
  worker_role?: string;
  /**
   * Explicit tool allow-list. Overrides the role-based default from
   * worker_role. Use ["*"] for unrestricted access (Coordinator mode).
   *
   * Example: ["Read", "Glob", "Grep", "Bash"] for a reviewer
   * Example: ["*"] for full tool access
   */
  allowed_tools?: string[];
  /**
   * When true, fork the session instead of spawning a fresh sub-agent.
   * A forked agent inherits the parent's full message history and
   * full tool registry — ideal for deep-dive analysis of the current
   * conversation context. Returns summary text rather than full transcript.
   * Default: false.
   */
  fork?: boolean;
}

export interface AgentSpawnOutput {
  agentId: string;
  status: 'spawned' | 'forked';
  description: string;
  subagentType: string;
  workerRole?: string;
}

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

const AGENT_SPAWN_DESCRIPTION = `Launch a new agent to handle complex, multi-step tasks. Each agent type has specific capabilities and tools available to it.

Available agent types and the tools they have access to:
- Explore: Fast read-only search agent for locating code. Use it to find files by pattern (eg. "src/components/**/*.tsx"), grep for symbols or keywords (eg. "API endpoints"), or answer "where is X defined / which files reference Y." Do NOT use it for code review, design-doc auditing, cross-file consistency checks, or open-ended analysis — it reads excerpts rather than whole files and will miss content past its read window. When calling, specify search breadth: "quick" for a single targeted lookup, "medium" for moderate exploration, or "very thorough" to search across multiple locations and naming conventions. (Tools: All tools except Agent, ExitPlanMode, Edit, Write, NotebookEdit)
- general-purpose: General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you. (Tools: *)
- Plan: Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs. (Tools: All tools except Agent, ExitPlanMode, Edit, Write, NotebookEdit)

The agent runs in the background — spawn() returns immediately with an agentId.
Use AgentRead to check its transcript, AgentMessage to send follow-up instructions,
and AgentStop to cancel it.

Worker Roles (Agent Teams protocol):
- Leave worker_role unset for traditional sub-agent behavior.
- Set worker_role to "explore", "builder", or "reviewer" for role-based tool restrictions.
- Use allowed_tools to override the role-based default tool set (e.g., ["*"] for full access).

When NOT to use:
- If the target is already known, use the direct tool: Read for a known path, the Grep tool for a specific symbol or string. Reserve this tool for open-ended questions that span the codebase.`;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_SUBAGENT_TYPES = new Set(['Explore', 'general-purpose', 'Plan']);

// ---------------------------------------------------------------------------
// AgentSpawnTool
// ---------------------------------------------------------------------------

export class AgentSpawnTool extends BaseTool<AgentSpawnInput, AgentSpawnOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'Agent',
      description: AGENT_SPAWN_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'A short (3-5 word) description of the task',
          },
          prompt: {
            type: 'string',
            description: 'The task for the agent to perform',
          },
          subagent_type: {
            type: 'string',
            enum: ['Explore', 'general-purpose', 'Plan'],
            description: 'The type of specialized agent to use for this task. Defaults to general-purpose if omitted.',
          },
          max_turns: {
            type: 'number',
            description: 'Maximum number of turns for the sub-agent (default: 50)',
          },
          worker_role: {
            type: 'string',
            enum: ['explore', 'builder', 'reviewer'],
            description: 'Worker role for Agent Teams protocol. Determines the default tool set for this Worker. Use allowed_tools to override.',
          },
          allowed_tools: {
            type: 'array',
            items: { type: 'string' },
            description: 'Explicit tool allow-list. Overrides the role-based default. Use ["*"] for full access (Coordinator mode).',
          },
          fork: {
            type: 'boolean',
            description: 'When true, fork the session (inherit parent message history and full tool access) instead of spawning a fresh restricted sub-agent.',
          },
        },
        required: ['description', 'prompt'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.MUTATION,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as AgentSpawnInput;
    if (!typed || typeof typed !== 'object') {
      return { valid: false, errors: [{ path: '', message: 'Input must be an object' }] };
    }
    if (typeof typed.description !== 'string' || typed.description.trim().length === 0) {
      return {
        valid: false,
        errors: [{ path: 'description', message: 'description must be a non-empty string' }],
      };
    }
    if (typeof typed.prompt !== 'string' || typed.prompt.trim().length === 0) {
      return {
        valid: false,
        errors: [{ path: 'prompt', message: 'prompt must be a non-empty string' }],
      };
    }
    if (typed.subagent_type !== undefined && !VALID_SUBAGENT_TYPES.has(typed.subagent_type)) {
      return {
        valid: false,
        errors: [{
          path: 'subagent_type',
          message: `Must be one of: ${[...VALID_SUBAGENT_TYPES].join(', ')}`,
        }],
      };
    }
    if (typed.max_turns !== undefined) {
      if (typeof typed.max_turns !== 'number' || typed.max_turns < 1 || typed.max_turns > 200) {
        return {
          valid: false,
          errors: [{ path: 'max_turns', message: 'max_turns must be between 1 and 200' }],
        };
      }
    }
    if (typed.worker_role !== undefined) {
      if (!isValidWorkerRole(typed.worker_role)) {
        return {
          valid: false,
          errors: [{
            path: 'worker_role',
            message: 'Must be one of: explore, builder, reviewer',
          }],
        };
      }
      if (typed.worker_role === WorkerRole.Coordinator) {
        return {
          valid: false,
          errors: [{
            path: 'worker_role',
            message: 'Coordinator role is not valid for Worker spawn. Use explore, builder, or reviewer.',
          }],
        };
      }
    }
    if (typed.allowed_tools !== undefined) {
      if (!Array.isArray(typed.allowed_tools)) {
        return {
          valid: false,
          errors: [{ path: 'allowed_tools', message: 'allowed_tools must be an array of strings' }],
        };
      }
      for (const tool of typed.allowed_tools) {
        if (typeof tool !== 'string') {
          return {
            valid: false,
            errors: [{ path: 'allowed_tools', message: 'Each item in allowed_tools must be a string' }],
          };
        }
      }
    }
    if (typed.fork !== undefined && typeof typed.fork !== 'boolean') {
      return {
        valid: false,
        errors: [{ path: 'fork', message: 'fork must be a boolean' }],
      };
    }
    return { valid: true };
  }

  override async execute(
    input: AgentSpawnInput,
    ctx: ToolContext,
  ): Promise<AgentSpawnOutput> {
    const bus = getSubagentBus();

    // Resolve workerRole and allowedTools for Agent Teams protocol
    const workerRole = input.worker_role
      ? (input.worker_role as WorkerRole)
      : undefined;

    // Fork session: inherit parent's full message context and tool registry
    if (input.fork) {
      const agentId = bus.forkSession(ctx.sessionId, {
        description: input.description,
        prompt: input.prompt,
        // parentMessages is left undefined — the createForkAgentCallback
        // obtains them from the parent SessionManager at invocation time
        maxTurns: input.max_turns,
      });

      return {
        agentId,
        status: 'forked',
        description: input.description,
        subagentType: input.subagent_type ?? 'general-purpose',
        workerRole: input.worker_role,
      };
    }

    // Standard spawn: restricted sub-agent
    // Build workerConfig: allowed_tools takes precedence over role defaults
    let workerConfig: WorkerConfig | undefined;
    if (workerRole || input.allowed_tools) {
      const allowedTools = input.allowed_tools
        ? input.allowed_tools
        : workerRole
          ? getDefaultToolsForRole(workerRole)
          : undefined;

      workerConfig = {
        role: workerRole ?? WorkerRole.Builder,
        allowedTools: allowedTools ?? ['*'],
        maxTurns: input.max_turns ?? 50,
        contextIsolation: true,
      };
    }

    const agentId = bus.spawn(ctx.sessionId, {
      description: input.description,
      prompt: input.prompt,
      subagentType: input.subagent_type ?? 'general-purpose',
      maxTurns: input.max_turns,
      workerConfig,
    });

    return {
      agentId,
      status: 'spawned',
      description: input.description,
      subagentType: input.subagent_type ?? 'general-purpose',
      workerRole: input.worker_role,
    };
  }

  override formatOutput(result: AgentSpawnOutput): string {
    const roleSuffix = result.workerRole ? ` [${result.workerRole}]` : '';
    const action = result.status === 'forked' ? 'Session forked' : 'Agent spawned';
    return `${action}: [${result.agentId}] ${result.description} (${result.subagentType})${roleSuffix}`;
  }
}
