/**
 * AgentStopTool — Abort a running sub-agent
 *
 * Sends an abort signal to a running background worker sub-agent via
 * its AbortController. The sub-agent's status transitions to 'aborted'
 * and its transcript is preserved for reading.
 *
 * Risk: SAFE — only calls AbortController.abort() in-memory.
 */

import {
  BaseTool,
  RiskLevel,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
} from '@kode/shared';
import { getSubagentBus } from '@kode/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentStopInput {
  /** Sub-agent ID to abort */
  agentId: string;
}

export interface AgentStopOutput {
  agentId: string;
  stopped: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

const AGENT_STOP_DESCRIPTION = `Abort a running sub-agent by its unique identifier.

This sends an abort signal to the background worker, causing it to
stop processing. The sub-agent's transcript is preserved and can
still be read with AgentRead.

Use this when:
- The sub-agent is running too long or appears stuck
- The parent no longer needs the results of the worker
- The sub-agent was created in error

Parameters:
- agentId: The unique identifier of the sub-agent to abort`;

// ---------------------------------------------------------------------------
// AgentStopTool
// ---------------------------------------------------------------------------

export class AgentStopTool extends BaseTool<AgentStopInput, AgentStopOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'AgentStop',
      description: AGENT_STOP_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          agentId: {
            type: 'string',
            description: 'The unique identifier of the running sub-agent to abort',
          },
        },
        required: ['agentId'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.SAFE,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as AgentStopInput;
    if (!typed || typeof typed !== 'object') {
      return { valid: false, errors: [{ path: '', message: 'Input must be an object' }] };
    }
    if (typeof typed.agentId !== 'string' || typed.agentId.trim().length === 0) {
      return {
        valid: false,
        errors: [{ path: 'agentId', message: 'agentId must be a non-empty string' }],
      };
    }
    return { valid: true };
  }

  override async execute(input: AgentStopInput, _ctx: ToolContext): Promise<AgentStopOutput> {
    const bus = getSubagentBus();
    const entry = bus.get(input.agentId);

    if (!entry) {
      return {
        agentId: input.agentId,
        stopped: false,
        reason: `Agent ${input.agentId} not found. It may have already completed.`,
      };
    }

    if (entry.status !== 'running') {
      return {
        agentId: input.agentId,
        stopped: false,
        reason: `Agent ${input.agentId} is not running (status: ${entry.status}).`,
      };
    }

    const aborted = bus.abort(input.agentId);

    return {
      agentId: input.agentId,
      stopped: aborted,
      reason: aborted ? undefined : `Failed to abort agent ${input.agentId}.`,
    };
  }

  override formatOutput(result: AgentStopOutput): string {
    if (result.stopped) {
      return `Agent ${result.agentId} has been stopped. Its transcript is preserved for reading.`;
    }
    return `Agent ${result.agentId} was NOT stopped: ${result.reason ?? 'unknown reason'}`;
  }
}
