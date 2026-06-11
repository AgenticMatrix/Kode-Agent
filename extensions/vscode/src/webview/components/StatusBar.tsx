import { h } from 'preact';
import type { UsageInfo } from '../../types/webviewProtocol';

interface StatusBarProps {
  status: string;
  model: string;
  usage: UsageInfo | null;
  isBusy: boolean;
  sessionId: string;
  sessionTitle: string;
  onNewSession: () => void;
  onSessionClick: () => void;
}

export function StatusBar({
  status,
  model,
  usage,
  isBusy,
  sessionId,
  sessionTitle,
  onNewSession,
  onSessionClick,
}: StatusBarProps): h.JSX.Element {
  return (
    <div class="status-bar">
      <span class={`status-indicator ${isBusy ? 'status-busy' : 'status-idle'}`}>
        {isBusy ? '●' : '○'} {status}
      </span>
      {model && <span class="status-model">{model}</span>}
      {sessionTitle && (
        <span class="status-session" title={sessionId} onClick={onSessionClick}>
          {sessionTitle}
        </span>
      )}
      <button class="new-session-btn" onClick={onNewSession} title="New session">
        +
      </button>
      {usage && (
        <span class="status-usage">
          {usage.total.toLocaleString()} tokens
          {usage.cost_usd ? ` · $${usage.cost_usd.toFixed(2)}` : ''}
        </span>
      )}
    </div>
  );
}
