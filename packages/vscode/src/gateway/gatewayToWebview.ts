/**
 * gatewayToWebview.ts — Translate GatewayEvent → WebviewOutboundMessage
 *
 * Maps the shared bridge events (from @coder/bridge) into the webview's
 * message format. Each GatewayEvent maps to zero or more webview messages.
 */

import type { GatewayEvent } from '@coder/bridge';
import type { WebviewOutboundMessage, UsageInfo } from '../types/webviewProtocol';

export function gatewayToWebview(
  ev: GatewayEvent,
  sessionId: string,
): WebviewOutboundMessage[] {
  const sid = ev.session_id ?? sessionId;

  switch (ev.type) {
    case 'message.start':
      return [];

    case 'message.delta':
      return [{ type: 'messageDelta', text: ev.payload?.text ?? ev.payload?.rendered ?? '', sessionId: sid }];

    case 'message.complete': {
      const p = ev.payload ?? {};
      const usage: UsageInfo | undefined = p.usage
        ? {
            calls: p.usage.calls ?? 1,
            input: p.usage.input ?? 0,
            output: p.usage.output ?? 0,
            total: p.usage.total ?? 0,
            cost_usd: p.usage.cost_usd,
          }
        : undefined;
      return [{ type: 'messageComplete', text: p.text ?? '', usage, sessionId: sid }];
    }

    case 'thinking.delta':
      return []; // VS Code webview doesn't show thinking details for now

    case 'tool.start': {
      const sp = ev.payload;
      return [
        {
          type: 'toolStart',
          toolId: sp.tool_id,
          name: sp.name ?? 'unknown',
          args: sp.args_text,
        },
      ];
    }

    case 'tool.complete': {
      const cp = ev.payload;
      return [
        {
          type: 'toolComplete',
          toolId: cp.tool_id,
          name: cp.name ?? 'unknown',
          durationMs: Math.round((cp.duration_s ?? 0) * 1000),
          error: cp.error,
        },
      ];
    }

    case 'tool.progress':
    case 'tool.generating':
    case 'tool.input_delta':
      return [];

    case 'approval.request': {
      const ap = ev.payload;
      return [
        {
          type: 'approvalRequest',
          requestId: ap.request_id ?? ap.tool_use_id ?? '',
          command: ap.command,
          description: ap.description,
        },
      ];
    }

    case 'status.update': {
      const sup = ev.payload ?? {};
      const kind = sup.kind ?? '';
      let status: 'thinking' | 'generating' | 'running_tool' | 'ready' | 'error' = 'ready';
      if (kind === 'thinking') status = 'thinking';
      else if (kind === 'generating') status = 'generating';
      else if (kind === 'tool') status = 'running_tool';
      else if (kind === 'error') status = 'error';

      return [{ type: 'statusUpdate', status, message: sup.text, sessionId: sid }];
    }

    case 'error': {
      return [
        { type: 'errorMessage', message: ev.payload?.message ?? 'Unknown error' },
        { type: 'statusUpdate', status: 'error', message: ev.payload?.message, sessionId: sid },
      ];
    }

    case 'session.info': {
      const info = ev.payload;
      return [
        {
          type: 'configUpdate',
          config: {
            model: info?.model ?? '',
            provider: '',
            permissionMode: 'ask',
          },
        },
      ];
    }

    // Events we don't translate to webview yet
    case 'gateway.ready':
    case 'gateway.stderr':
    case 'gateway.start_timeout':
    case 'gateway.protocol_error':
    case 'skin.changed':
    case 'reasoning.delta':
    case 'reasoning.available':
    case 'voice.status':
    case 'voice.transcript':
    case 'browser.progress':
    case 'clarify.request':
    case 'sudo.request':
    case 'secret.request':
    case 'background.complete':
    case 'review.summary':
    case 'subagent.spawn_requested':
    case 'subagent.start':
    case 'subagent.thinking':
    case 'subagent.tool':
    case 'subagent.progress':
    case 'subagent.complete':
      return [];
  }
}
