/**
 * AgentMessageTool — Send a follow-up message to a running sub-agent
 *
 * Sends a text message to an existing background worker sub-agent,
 * preserving its existing context. The message is appended to the
 * sub-agent's transcript and forwarded to the worker.
 *
 * This is non-blocking — the parent continues while the worker
 * processes the message asynchronously.
 *
 * Risk: SAFE — only writes to in-memory transcript buffer.
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

export interface AgentMessageInput {
  /** Sub-agent ID to send the message to */
  agentId: string;
  /** Message text to send to the sub-agent */
  message: string;
}

export interface AgentMessageOutput {
  agentId: string;
  delivered: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

const AGENT_MESSAGE_DESCRIPTION = `Send a follow-up message to a running sub-agent.

This preserves the sub-agent's existing context and appends the new
message as if the parent agent spoke directly to the worker.

The parent agent continues immediately — this is non-blocking.
The sub-agent processes the message asynchronously.

Use this to:
- Ask the sub-agent to elaborate on a finding
- Request additional analysis without restarting the worker
- Provide updated instructions mid-task

Parameters:
- agentId: The unique identifier of a running sub-agent
- message: The text message to send`;

// ---------------------------------------------------------------------------
// AgentMessageTool
// ---------------------------------------------------------------------------

export class AgentMessageTool extends BaseTool<AgentMessageInput, AgentMessageOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'AgentMessage',
      description: AGENT_MESSAGE_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          agentId: {
            type: 'string',
            description: 'The unique identifier of the running sub-agent to message',
          },
          message: {
            type: 'string',
            description: 'The text message to send to the sub-agent',
          },
        },
        required: ['agentId', 'message'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.SAFE,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as AgentMessageInput;
    if (!typed || typeof typed !== 'object') {
      return { valid: false, errors: [{ path: '', message: 'Input must be an object' }] };
    }
    if (typeof typed.agentId !== 'string' || typed.agentId.trim().length === 0) {
      return {
        valid: false,
        errors: [{ path: 'agentId', message: 'agentId must be a non-empty string' }],
      };
    }
    if (typeof typed.message !== 'string' || typed.message.trim().length === 0) {
      return {
        valid: false,
        errors: [{ path: 'message', message: 'message must be a non-empty string' }],
      };
    }
    return { valid: true };
  }

  override async execute(input: AgentMessageInput, _ctx: ToolContext): Promise<AgentMessageOutput> {
    const bus = getSubagentBus();

    // Try sending via message queue (Worker is running or spawned)
    const queued = bus.sendMessage(input.agentId, {
      role: 'user',
      content: input.message,
    });

    if (queued) {
      return {
        agentId: input.agentId,
        delivered: true,
      };
    }

    // Worker not found or not running — check if it ever existed
    const entry = bus.get(input.agentId);
    if (!entry) {
      return {
        agentId: input.agentId,
        delivered: false,
        reason: `Agent ${input.agentId} not found. It may have completed or been cleaned up.`,
      };
    }

    // Worker exists but isn't running (completed/errored/aborted)
    return {
      agentId: input.agentId,
      delivered: false,
      reason: `Agent ${input.agentId} is not running (status: ${entry.status}). Message appended to transcript as fallback.`,
    };
  }

  override formatOutput(result: AgentMessageOutput): string {
    if (result.delivered) {
      return `Message delivered to agent ${result.agentId}.`;
    }
    return `Message NOT delivered: ${result.reason ?? 'unknown reason'}`;
  }
}
