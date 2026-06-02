/**
 * AgentReadTool — Read sub-agent transcript output
 *
 * Reads the accumulated transcript of a running or recently completed
 * sub-agent with pagination support (offset/limit). Used by the parent
 * Agent Loop to inspect what background workers have done.
 *
 * Risk: SAFE — read-only access to in-memory transcript buffer.
 */

import {
  BaseTool,
  RiskLevel,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
} from '@coder/shared';
import { getSubagentBus } from '@coder/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentReadInput {
  /** Sub-agent ID to read transcript from */
  agentId: string;
  /** Line offset for pagination (default: 0) */
  offset?: number;
  /** Maximum lines to return (default: 100, max: 500) */
  limit?: number;
}

export interface AgentReadOutput {
  agentId: string;
  status: string;
  lines: string[];
  totalLines: number;
  offset: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

const AGENT_READ_DESCRIPTION = `Read the transcript output of a sub-agent (running or recently completed).

Each sub-agent generates a transcript of its actions and responses.
This tool lets the parent agent inspect that transcript with pagination:

- agentId: The unique identifier of the sub-agent to read
- offset: Line number to start reading from (0-based, default 0)
- limit: Maximum lines to return (default 100, max 500)

Returns the transcript lines, total line count, and whether more lines
are available. Use sequential calls with increasing offset to paginate
through long transcripts.`;

// ---------------------------------------------------------------------------
// AgentReadTool
// ---------------------------------------------------------------------------

export class AgentReadTool extends BaseTool<AgentReadInput, AgentReadOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'AgentRead',
      description: AGENT_READ_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          agentId: {
            type: 'string',
            description: 'The unique identifier of the sub-agent to read',
          },
          offset: {
            type: 'number',
            description: 'Line offset for pagination (0-based, default: 0)',
          },
          limit: {
            type: 'number',
            description: 'Maximum lines to return (default: 100, max: 500)',
          },
        },
        required: ['agentId'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.SAFE,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as AgentReadInput;
    if (!typed || typeof typed !== 'object') {
      return { valid: false, errors: [{ path: '', message: 'Input must be an object' }] };
    }
    if (typeof typed.agentId !== 'string' || typed.agentId.trim().length === 0) {
      return {
        valid: false,
        errors: [{ path: 'agentId', message: 'agentId must be a non-empty string' }],
      };
    }
    if (typed.offset !== undefined && (typeof typed.offset !== 'number' || typed.offset < 0)) {
      return {
        valid: false,
        errors: [{ path: 'offset', message: 'offset must be a non-negative number' }],
      };
    }
    if (typed.limit !== undefined && (typeof typed.limit !== 'number' || typed.limit < 1 || typed.limit > 500)) {
      return {
        valid: false,
        errors: [{ path: 'limit', message: 'limit must be between 1 and 500' }],
      };
    }
    return { valid: true };
  }

  override async execute(input: AgentReadInput, _ctx: ToolContext): Promise<AgentReadOutput> {
    const bus = getSubagentBus();
    const offset = input.offset ?? 0;
    const limit = Math.min(input.limit ?? 100, 500);

    const result = bus.readTranscript(input.agentId, offset, limit);

    if (!result) {
      return {
        agentId: input.agentId,
        status: 'unknown',
        lines: [],
        totalLines: 0,
        offset,
        hasMore: false,
      };
    }

    return {
      agentId: input.agentId,
      status: result.status,
      lines: result.lines,
      totalLines: result.totalLines,
      offset,
      hasMore: offset + limit < result.totalLines,
    };
  }

  override formatOutput(result: AgentReadOutput): string {
    if (result.status === 'unknown') {
      return `Agent ${result.agentId} not found. It may have been cleaned up or never existed.`;
    }

    const header = `Agent ${result.agentId} (${result.status}) — lines ${result.offset + 1}-${result.offset + result.lines.length} of ${result.totalLines}${result.hasMore ? ' (more available)' : ''}`;
    if (result.lines.length === 0) {
      return `${header}\n(no output yet)`;
    }
    return `${header}\n${result.lines.join('\n')}`;
  }
}
