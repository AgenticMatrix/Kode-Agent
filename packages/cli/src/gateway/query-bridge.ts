/**
 * query-bridge.ts — Translate Agent Loop QueryMessage → TUI GatewayEvent
 *
 * This is the core translator between the Agent Loop's AsyncGenerator output
 * (QueryMessage) and the TUI's event stream (GatewayEvent). It accumulates
 * streaming state (text, tool use, usage) across consecutive messages and
 * emits GatewayEvents that the TUI components understand.
 *
 * Usage:
 *   const state = createBridgeState(sessionId);
 *   for await (const msg of query(config)) {
 *     const events = bridgeQueryToGateway(msg, state);
 *     for (const ev of events) gw.publish(ev);
 *   }
 */

import type {
  QueryMessage,
  StreamEvent,
  AssistantMessage,
  ToolProgress,
  CompactMetadata,
  DeferredPermission,
  CompletionUsage,
} from '@coder/shared';
import { AgentError } from '@coder/shared';
import type { GatewayEvent } from './types.js';

// ---------------------------------------------------------------------------
// Bridge State
// ---------------------------------------------------------------------------

export interface ActiveToolState {
  id: string;
  name: string;
  startTime: number;
  status: 'started' | 'running' | 'completed';
  /** Accumulated tool input JSON from input_json_delta events */
  inputJson: string;
}

export interface BridgeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalCost: number;
}

export interface PendingApproval {
  toolUseId: string;
  toolName: string;
  command: string;
  description: string;
  deferred: DeferredPermission;
}

export interface BridgeState {
  sessionId: string;
  /** Accumulated assistant text for the current turn */
  accumulatedText: string;
  /** Active tool invocations keyed by tool_use id */
  activeTools: Map<string, ActiveToolState>;
  /** Cumulative cost across all turns */
  totalCost: number;
  /** Usage for the current turn */
  usage: BridgeUsage;
  /** Tool execution results (id → result text) */
  toolResults: Map<string, string>;
  /** Pending permission approvals */
  pendingApprovals: PendingApproval[];
  /** Current model name */
  model: string;
  /** Turn counter */
  turnCount: number;
  /** Tool call count for the current turn */
  currentTurnToolCount: number;
  /** Whether the model is currently in an extended thinking block */
  inThinkingBlock: boolean;
  /** Index of the active thinking content block (null when not thinking) */
  thinkingBlockIndex: number | null;
  /** Whether a text generation block has been seen in this turn */
  hasTextStarted: boolean;
  /** Maps content block index → tool_use id for routing input_json_delta */
  toolBlockIndexToId: Map<number, string>;
}

export function createBridgeState(sessionId: string): BridgeState {
  return {
    sessionId,
    accumulatedText: '',
    activeTools: new Map(),
    totalCost: 0,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalCost: 0,
    },
    toolResults: new Map(),
    pendingApprovals: [],
    model: '',
    turnCount: 0,
    currentTurnToolCount: 0,
    inThinkingBlock: false,
    thinkingBlockIndex: null,
    hasTextStarted: false,
    toolBlockIndexToId: new Map(),
  };
}

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

function ev(
  type: GatewayEvent['type'],
  payload?: Record<string, unknown>,
  sessionId?: string,
): GatewayEvent {
  return { type, payload: payload as GatewayEvent['payload'], session_id: sessionId } as GatewayEvent;
}

export function resetTurnState(state: BridgeState): void {
  state.accumulatedText = '';
  state.activeTools.clear();
  state.currentTurnToolCount = 0;
  state.pendingApprovals = [];
  state.inThinkingBlock = false;
  state.thinkingBlockIndex = null;
  state.hasTextStarted = false;
  state.toolBlockIndexToId.clear();
  state.usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalCost: 0,
  };
}

// ---------------------------------------------------------------------------
// Main bridge function
// ---------------------------------------------------------------------------

/**
 * Translate a single QueryMessage into zero or more GatewayEvents.
 *
 * Maintains streaming state in `state` across calls. The caller should iterate
 * the query() AsyncGenerator and call this function for each yielded message.
 */
export function bridgeQueryToGateway(
  msg: QueryMessage,
  state: BridgeState,
): GatewayEvent[] {
  const events: GatewayEvent[] = [];
  const sid = state.sessionId;

  switch (msg.type) {
    // ── Stream events (incremental) ──────────────────────────────────
    case 'stream_event':
      events.push(...handleStreamEvent(msg.event, state, sid));
      break;

    // ── Assistant message (turn complete) ───────────────────────────
    case 'assistant':
      events.push(...handleAssistantMessage(msg.message, state, sid));
      break;

    // ── User message (tool results injected back) ────────────────────
    case 'user':
      // Store tool results so handleToolProgress('completed') can read them
      if (Array.isArray(msg.message.content)) {
        for (const block of msg.message.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const text = typeof block.content === 'string'
              ? block.content
              : (block.content ? JSON.stringify(block.content) : '');
            state.toolResults.set(block.tool_use_id, block.is_error ? `Error: ${text}` : text);
          }
        }
      }
      break;

    // ── System: progress (tool execution lifecycle) ──────────────────
    case 'system':
      switch (msg.subtype) {
        case 'progress':
          events.push(...handleToolProgress(msg.data, state, sid));
          break;

        case 'compact_boundary':
          events.push(...handleCompactBoundary(msg.compactMetadata, sid));
          break;

        case 'error':
          events.push(...handleSystemError(msg.error, sid));
          break;

        case 'permission_required':
          events.push(...handlePermissionRequired(msg.deferred, state, sid));
          break;
      }
      break;
  }

  return events;
}

// ---------------------------------------------------------------------------
// Stream event handlers
// ---------------------------------------------------------------------------

function handleStreamEvent(
  event: StreamEvent,
  state: BridgeState,
  sid: string,
): GatewayEvent[] {
  const events: GatewayEvent[] = [];

  switch (event.type) {
    // ── Message start ──────────────────────────────────────────────
    case 'message_start':
      state.model = event.message.model ?? '';
      state.accumulatedText = '';
      state.currentTurnToolCount = 0;
      events.push(ev('message.start', undefined, sid));
      break;

    // ── Content block delta ────────────────────────────────────────
    case 'content_block_delta': {
      const delta = event.delta;

      if (delta.type === 'text_delta') {
        // ── Text delta: if we were thinking, transition to Generating ──
        if (state.inThinkingBlock) {
          state.inThinkingBlock = false;
          state.thinkingBlockIndex = null;
        }
        if (!state.hasTextStarted) {
          state.hasTextStarted = true;
          events.push(
            ev('status.update', { text: 'Generating…', kind: 'generating' }, sid),
          );
        }
        state.accumulatedText += delta.text;
        events.push(
          ev('message.delta', { text: delta.text }, sid),
        );
      } else if (delta.type === 'input_json_delta') {
        // Tool input JSON — route to tool state, not thinking
        const toolId = state.toolBlockIndexToId.get(event.index);
        if (toolId) {
          const tool = state.activeTools.get(toolId);
          if (tool) {
            tool.inputJson += delta.partial_json;
          }
          events.push(
            ev('tool.input_delta', { tool_id: toolId, partial_json: delta.partial_json }, sid),
          );
        }
      } else if (delta.type === 'thinking_delta') {
        // Extended thinking delta — forward as thinking.delta
        events.push(
          ev('thinking.delta', { text: delta.thinking }, sid),
        );
      }
      break;
    }

    // ── Content block start ────────────────────────────────────────
    case 'content_block_start': {
      const block = event.content_block;

      if (block.type === 'tool_use' && block.id && block.name) {
        state.currentTurnToolCount++;
        state.toolBlockIndexToId.set(event.index, block.id);
        state.activeTools.set(block.id, {
          id: block.id,
          name: block.name,
          startTime: Date.now(),
          status: 'started',
          inputJson: block.input ? JSON.stringify(block.input) : '',
        });

        events.push(
          ev('tool.start', {
            tool_id: block.id,
            name: block.name,
            args_text: block.input ? JSON.stringify(block.input) : undefined,
            context: block.input ? JSON.stringify(block.input).slice(0, 200) : undefined,
          }, sid),
        );
      } else if (block.type === 'thinking') {
        // ── Extended thinking block: update status to Thinking… ────
        state.inThinkingBlock = true;
        state.thinkingBlockIndex = event.index;
        if (!state.hasTextStarted) {
          events.push(
            ev('status.update', { text: 'Thinking…', kind: 'thinking' }, sid),
          );
        }
        events.push(
          ev('thinking.delta', { text: block.thinking ?? '' }, sid),
        );
      } else if (block.type === 'text') {
        // ── Text generation block: transition from Thinking → Generating ──
        if (state.inThinkingBlock) {
          state.inThinkingBlock = false;
          state.thinkingBlockIndex = null;
        }
        if (!state.hasTextStarted) {
          state.hasTextStarted = true;
          events.push(
            ev('status.update', { text: 'Generating…', kind: 'generating' }, sid),
          );
        }
      }
      break;
    }

    // ── Content block stop ─────────────────────────────────────────
    case 'content_block_stop':
      // Clean up thinking state if the stopped block was the thinking block
      if (state.thinkingBlockIndex !== null && event.index === state.thinkingBlockIndex) {
        state.thinkingBlockIndex = null;
      }
      break;

    // ── Message delta (usage updates) ───────────────────────────────
    case 'message_delta':
      if (event.delta.usage) {
        accumulateUsage(state.usage, event.delta.usage);
      }
      // stop_reason is handled in the assistant message
      break;

    // ── Message stop ────────────────────────────────────────────────
    case 'message_stop':
      // The assistant message (with full content) is emitted separately
      // as a 'assistant' QueryMessage. Here we just accumulate usage.
      if (event.message?.usage) {
        accumulateUsage(state.usage, event.message.usage);
      }
      break;

    // ── Cost update ─────────────────────────────────────────────────
    case 'cost_update':
      state.totalCost = event.totalCost;
      break;

    // ── Ping (no-op for TUI) ────────────────────────────────────────
    case 'ping':
      break;
  }

  return events;
}

// ---------------------------------------------------------------------------
// Assistant message handler
// ---------------------------------------------------------------------------

function handleAssistantMessage(
  message: AssistantMessage,
  state: BridgeState,
  sid: string,
): GatewayEvent[] {
  const events: GatewayEvent[] = [];

  // Accumulate final usage
  accumulateUsage(state.usage, message.usage);
  state.totalCost = message.usage?.totalCost ?? state.totalCost;
  state.turnCount++;

  // Build tool call summary
  const toolCallCount = message.toolUseBlocks?.length ?? state.currentTurnToolCount;
  const toolNames = message.toolUseBlocks?.map((b) => b.name) ?? [];

  events.push(
    ev('message.complete', {
      text: state.accumulatedText || extractTextContent(message),
      usage: {
        calls: 1,
        input: state.usage.inputTokens,
        output: state.usage.outputTokens,
        total: state.usage.inputTokens + state.usage.outputTokens,
        cost_usd: state.usage.totalCost || message.usage?.totalCost,
      },
      rendered: state.accumulatedText || undefined,
    }, sid),
  );

  // Status update with tool summary
  const statusText = toolCallCount > 0
    ? `Used ${toolCallCount} tool(s): ${toolNames.join(', ')}`
    : 'Turn complete';

  events.push(
    ev('status.update', { text: statusText }, sid),
  );

  resetTurnState(state);

  return events;
}

// ---------------------------------------------------------------------------
// Tool progress handler
// ---------------------------------------------------------------------------

function handleToolProgress(
  progress: ToolProgress,
  state: BridgeState,
  sid: string,
): GatewayEvent[] {
  const events: GatewayEvent[] = [];
  const tool = state.activeTools.get(progress.toolUseId);

  switch (progress.status) {
    case 'started':
      if (tool) {
        tool.status = 'started';
      } else {
        state.activeTools.set(progress.toolUseId, {
          id: progress.toolUseId,
          name: progress.toolName,
          startTime: Date.now(),
          status: 'started',
          inputJson: '',
        });
      }
      events.push(
        ev('status.update', {
          text: `Running ${progress.toolName}...`,
          kind: 'tool',
        }, sid),
      );
      break;

    case 'running':
      if (tool) {
        tool.status = 'running';
      }
      events.push(
        ev('status.update', {
          text: progress.message ?? `Running ${progress.toolName}...`,
          kind: 'tool',
        }, sid),
      );
      break;

    case 'completed': {
      const startTime = tool?.startTime ?? Date.now();
      const duration = (Date.now() - startTime) / 1000;

      if (tool) {
        tool.status = 'completed';
      }

      // Read result from progress.message (query.ts includes it now),
      // fall back to toolResults Map (populated by user message handler).
      const resultText = progress.message ?? state.toolResults.get(progress.toolUseId);

      // ── Determine error status (Fix 1: use structured is_error, not text heuristic) ─
      // Priority: 1) explicit is_error field from query.ts, 2) PreToolUse "Blocked:"
      // prefix from hook blocking, 3) legacy text heuristic for backwards compat.
      const isBlocked = resultText?.startsWith('Blocked:') ?? false;
      const isError = progress.is_error ?? isBlocked ?? resultText?.startsWith('Error:') ?? false;

      // ── Fix 2: Emit error status BEFORE tool.complete so the TUI shows it ──
      if (isError) {
        const errorMsg = (resultText ?? '').replace(/^(?:Error|Blocked):\s*/, '');
        events.push(
          ev('status.update', {
            text: `Tool "${progress.toolName}" failed: ${errorMsg}`,
            kind: 'error',
          }, sid),
        );
      }

      events.push(
        ev('tool.complete', {
          tool_id: progress.toolUseId,
          name: progress.toolName,
          duration_s: Math.round(duration * 100) / 100,
          result_text: resultText?.slice(0, 500),
          error: isError ? (resultText ?? 'Unknown error') : undefined,
          summary: progress.message,
        }, sid),
      );

      // Clean up
      state.activeTools.delete(progress.toolUseId);
      state.toolResults.delete(progress.toolUseId);
      break;
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Compact boundary handler
// ---------------------------------------------------------------------------

function handleCompactBoundary(
  meta: CompactMetadata,
  sid: string,
): GatewayEvent[] {
  return [
    ev('status.update', {
      text: `Compressing context (${meta.beforeTokens.toLocaleString()} → ${meta.afterTokens.toLocaleString()} tokens, ${meta.strategy})`,
      kind: 'info',
    }, sid),
  ];
}

// ---------------------------------------------------------------------------
// System error handler
// ---------------------------------------------------------------------------

function handleSystemError(
  error: AgentError,
  sid: string,
): GatewayEvent[] {
  return [
    ev('error', { message: `${error.code}: ${error.message}` }, sid),
    ev('status.update', {
      text: `Error: ${error.message}`,
      kind: 'error',
    }, sid),
  ];
}

// ---------------------------------------------------------------------------
// Permission required handler
// ---------------------------------------------------------------------------

function handlePermissionRequired(
  deferred: DeferredPermission,
  state: BridgeState,
  sid: string,
): GatewayEvent[] {
  // Store for later resolution
  state.pendingApprovals.push({
    toolUseId: deferred.toolUseId,
    toolName: deferred.toolName,
    command: deferred.command,
    description: deferred.description,
    deferred,
  });

  return [
    ev('approval.request', {
      command: deferred.command,
      description: deferred.description,
      request_id: deferred.toolUseId,
      tool_use_id: deferred.toolUseId,
    }, sid),
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function accumulateUsage(
  target: BridgeUsage,
  source: CompletionUsage,
): void {
  target.inputTokens += source.input_tokens;
  target.outputTokens += source.output_tokens;
  target.cacheCreationInputTokens += source.cache_creation_input_tokens ?? 0;
  target.cacheReadInputTokens += source.cache_read_input_tokens ?? 0;
  if (source.totalCost) {
    target.totalCost += source.totalCost;
  }
}

/**
 * Extract plain text content from an assistant message.
 */
function extractTextContent(message: AssistantMessage): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('\n');
  }
  return '';
}

// ---------------------------------------------------------------------------
// Approval resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a pending approval. Called by the TUI when the user approves/denies.
 *
 * Returns the tool name that was resolved, or null if no matching approval.
 *
 * **NOTE**: This function resolves ONLY the inline DeferredPermission (System A).
 * In production, coder-client.ts handles approval resolution directly because it
 * must also resolve via the global pendingPermissions Map (System B) via
 * resolvePermission(). This function remains exported for integration tests
 * where System B is not in play.
 */
export function resolveApproval(
  state: BridgeState,
  toolUseId: string,
  allowed: boolean,
): string | null {
  const idx = state.pendingApprovals.findIndex((a) => a.toolUseId === toolUseId);
  if (idx === -1) return null;

  const approval = state.pendingApprovals[idx]!;
  state.pendingApprovals.splice(idx, 1);

  // Resolve the deferred promise so the Agent Loop can continue
  approval.deferred.resolve(allowed);

  return approval.toolName;
}
