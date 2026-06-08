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
import type { GatewayEvent } from './events.js';
import type { BridgeState } from './bridge-state.js';
import { resetTurnState } from './bridge-state.js';

function ev(
  type: GatewayEvent['type'],
  payload?: Record<string, unknown>,
  sessionId?: string,
): GatewayEvent {
  return { type, payload: payload as GatewayEvent['payload'], session_id: sessionId } as GatewayEvent;
}

function accumulateUsage(
  target: BridgeState['usage'],
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

function handleStreamEvent(
  event: StreamEvent,
  state: BridgeState,
  sid: string,
): GatewayEvent[] {
  const events: GatewayEvent[] = [];

  switch (event.type) {
    case 'message_start':
      state.model = event.message.model ?? '';
      state.accumulatedText = '';
      state.currentTurnToolCount = 0;
      events.push(ev('message.start', undefined, sid));
      break;

    case 'content_block_delta': {
      const delta = event.delta;

      if (delta.type === 'text_delta') {
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
        events.push(
          ev('thinking.delta', { text: delta.thinking }, sid),
        );
      }
      break;
    }

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

    case 'content_block_stop':
      if (state.thinkingBlockIndex !== null && event.index === state.thinkingBlockIndex) {
        state.thinkingBlockIndex = null;
      }
      break;

    case 'message_delta':
      if (event.delta.usage) {
        accumulateUsage(state.usage, event.delta.usage);
      }
      break;

    case 'message_stop':
      if (event.message?.usage) {
        accumulateUsage(state.usage, event.message.usage);
      }
      break;

    case 'cost_update':
      state.totalCost = event.totalCost;
      break;

    case 'ping':
      break;
  }

  return events;
}

function handleAssistantMessage(
  message: AssistantMessage,
  state: BridgeState,
  sid: string,
): GatewayEvent[] {
  const events: GatewayEvent[] = [];

  accumulateUsage(state.usage, message.usage);
  state.totalCost = message.usage?.totalCost ?? state.totalCost;
  state.turnCount++;

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

  const statusText = toolCallCount > 0
    ? `Used ${toolCallCount} tool(s): ${toolNames.join(', ')}`
    : 'Turn complete';

  events.push(
    ev('status.update', { text: statusText }, sid),
  );

  resetTurnState(state);

  return events;
}

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

      const resultText = progress.message ?? state.toolResults.get(progress.toolUseId);

      const isBlocked = resultText?.startsWith('Blocked:') ?? false;
      const isError = progress.is_error ?? isBlocked ?? resultText?.startsWith('Error:') ?? false;

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

      state.activeTools.delete(progress.toolUseId);
      state.toolResults.delete(progress.toolUseId);
      break;
    }
  }

  return events;
}

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

function handlePermissionRequired(
  deferred: DeferredPermission,
  state: BridgeState,
  sid: string,
): GatewayEvent[] {
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

export function bridgeQueryToGateway(
  msg: QueryMessage,
  state: BridgeState,
): GatewayEvent[] {
  const events: GatewayEvent[] = [];
  const sid = state.sessionId;

  switch (msg.type) {
    case 'stream_event':
      events.push(...handleStreamEvent(msg.event, state, sid));
      break;

    case 'assistant':
      events.push(...handleAssistantMessage(msg.message, state, sid));
      break;

    case 'user':
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
