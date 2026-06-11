import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { ChatList } from './components/ChatList';
import { InputBox } from './components/InputBox';
import { StatusBar } from './components/StatusBar';
import { ToolApprovalCard } from './components/ToolApprovalCard';
import { SessionPicker } from './components/SessionPicker';
import { useVsCodeApi } from './hooks/useVsCodeApi';
import type { WebviewOutboundMessage, WebviewInboundMessage, UsageInfo, SessionSummary } from '../types/webviewProtocol';

export interface ChatMessage {
  id: string;
  role: 'assistant' | 'user' | 'system' | 'tool';
  text: string;
  isStreaming?: boolean;
}

export interface ToolState {
  toolId: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  error?: string;
}

export interface ApprovalState {
  requestId: string;
  command: string;
  description: string;
  pending: boolean;
}

let nextId = 1;

export function App(): h.JSX.Element {
  const vscode = useVsCodeApi();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const streamingRef = useRef('');
  const [statusText, setStatusText] = useState('Ready');
  const [tools, setTools] = useState<ToolState[]>([]);
  const [approval, setApproval] = useState<ApprovalState | null>(null);
  const [model, setModel] = useState('');
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const busyRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [sessionTitle, setSessionTitle] = useState('');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Notify extension that webview is ready
  useEffect(() => {
    vscode.postMessage({ type: 'webviewReady' } as WebviewInboundMessage);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Check connection timeout
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!connected) {
        setStatusText('Gateway starting...');
      }
    }, 10000);
    return () => clearTimeout(timer);
  }, [connected]);

  // Incoming messages from extension host
  useEffect(() => {
    const handler = (event: MessageEvent<WebviewOutboundMessage>): void => {
      const msg = event.data;
      setConnected(true);

      switch (msg.type) {
        case 'webviewReady':
          break;

        case 'messageDelta': {
          const updated = streamingRef.current + msg.text;
          streamingRef.current = updated;
          setStreamingText(updated);
          break;
        }

        case 'messageComplete': {
          const finalText = msg.text || streamingRef.current;
          if (finalText) {
            setMessages((prev) => [
              ...prev,
              { id: `msg-${nextId++}`, role: 'assistant', text: finalText },
            ]);
          }
          streamingRef.current = '';
          setStreamingText('');
          if (msg.usage) setUsage(msg.usage);
          break;
        }

        case 'toolStart':
          setTools((prev) => [
            ...prev,
            { toolId: msg.toolId, name: msg.name, status: 'running' },
          ]);
          break;

        case 'toolComplete':
          setTools((prev) =>
            prev.map((t) =>
              t.toolId === msg.toolId
                ? { ...t, status: msg.error ? 'error' : 'completed', error: msg.error }
                : t,
            ),
          );
          break;

        case 'approvalRequest':
          setApproval({
            requestId: msg.requestId,
            command: msg.command,
            description: msg.description,
            pending: true,
          });
          break;

        case 'statusUpdate': {
          const wasBusy = busyRef.current;
          const nowBusy = msg.status !== 'ready' && msg.status !== 'error';
          busyRef.current = nowBusy;
          setIsBusy(nowBusy);
          if (msg.message) setStatusText(msg.message);
          if (wasBusy && !nowBusy && msg.status === 'ready') {
            document.documentElement.classList.add('flash-done');
            setTimeout(() => document.documentElement.classList.remove('flash-done'), 1500);
          }
          break;
        }

        case 'errorMessage':
          setMessages((prev) => [
            ...prev,
            { id: `err-${nextId++}`, role: 'system', text: `Error: ${msg.message}` },
          ]);
          break;

        case 'configUpdate':
          if (msg.config.model) setModel(msg.config.model);
          break;

        case 'themeChange':
          document.documentElement.setAttribute('data-theme', msg.kind);
          break;

        case 'sessionHistory':
          setMessages(
            msg.messages.map((m, i) => ({
              id: `hist-${i}`,
              role: m.role,
              text: m.text,
            })),
          );
          break;

        case 'sessionSwitched':
          setSessionId(msg.sessionId);
          setSessionTitle(msg.title);
          break;

        case 'sessionList':
          setSessions(msg.sessions);
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Submit prompt to extension
  const handleSubmit = useCallback(
    (text: string) => {
      setMessages((prev) => [
        ...prev,
        { id: `msg-${nextId++}`, role: 'user', text },
      ]);
      streamingRef.current = '';
      setStreamingText('');
      setTools([]);
      setApproval(null);
      vscode.postMessage({ type: 'submitPrompt', text } as WebviewInboundMessage);
    },
    [vscode],
  );

  // Request session list
  const handleListSessions = useCallback(() => {
    vscode.postMessage({ type: 'listSessions' } as WebviewInboundMessage);
  }, [vscode]);

  // Session picker
  const handleOpenPicker = useCallback(() => {
    setPickerOpen(true);
    vscode.postMessage({ type: 'listSessions' } as WebviewInboundMessage);
  }, [vscode]);

  const handleSelectSession = useCallback(
    (id: string) => {
      vscode.postMessage({ type: 'selectSession', sessionId: id } as WebviewInboundMessage);
    },
    [vscode],
  );

  // Approval response
  const handleApproval = useCallback(
    (allowed: boolean) => {
      if (!approval) return;
      vscode.postMessage({
        type: 'approvalRespond',
        requestId: approval.requestId,
        allowed,
      } as WebviewInboundMessage);
      setApproval((prev) => (prev ? { ...prev, pending: false } : null));
    },
    [vscode, approval],
  );

  return (
    <div class="coder-app">
      <ChatList
        messages={messages}
        streamingText={streamingText}
        tools={tools}
        onFileClick={(path) => vscode.postMessage({ type: 'openFile', path } as WebviewInboundMessage)}
      />
      {approval?.pending && (
        <ToolApprovalCard
          command={approval.command}
          description={approval.description}
          onApprove={() => handleApproval(true)}
          onDeny={() => handleApproval(false)}
        />
      )}
      <StatusBar
        status={statusText}
        model={model}
        usage={usage}
        isBusy={isBusy}
        sessionId={sessionId}
        sessionTitle={sessionTitle}
        onNewSession={() => vscode.postMessage({ type: 'newSession' } as WebviewInboundMessage)}
        onSessionClick={handleOpenPicker}
      />
      <SessionPicker
        sessions={sessions}
        currentSessionId={sessionId}
        onSelect={handleSelectSession}
        onRefresh={() => vscode.postMessage({ type: 'listSessions' } as WebviewInboundMessage)}
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
      />
      <InputBox
        onSubmit={handleSubmit}
        onInterrupt={() => vscode.postMessage({ type: 'interrupt' } as WebviewInboundMessage)}
        isBusy={isBusy}
      />
    </div>
  );
}
