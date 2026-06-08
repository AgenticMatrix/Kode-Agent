import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import type { SessionSummary } from '../../types/webviewProtocol';

interface SessionPickerProps {
  sessions: SessionSummary[];
  currentSessionId: string;
  onSelect: (sessionId: string) => void;
  onRefresh: () => void;
  isOpen: boolean;
  onClose: () => void;
}

export function SessionPicker({
  sessions,
  currentSessionId,
  onSelect,
  onRefresh,
  isOpen,
  onClose,
}: SessionPickerProps): h.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    setTimeout(() => document.addEventListener('click', handler), 0);
    return () => document.removeEventListener('click', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div class="session-picker-overlay">
      <div class="session-picker" ref={ref}>
        <div class="session-picker-header">
          <span>Sessions</span>
          <button class="session-refresh-btn" onClick={onRefresh} title="Refresh">
            ↻
          </button>
        </div>
        <div class="session-picker-list">
          {sessions.length === 0 && (
            <div class="session-picker-empty">No sessions found</div>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              class={`session-picker-item ${s.id === currentSessionId ? 'session-active' : ''}`}
              onClick={() => { onSelect(s.id); onClose(); }}
            >
              <div class="session-item-title">{s.title}</div>
              <div class="session-item-meta">
                {s.messageCount} turns
                {s.startedAt ? ` · ${new Date(s.startedAt).toLocaleDateString()}` : ''}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
