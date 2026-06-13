// ---------------------------------------------------------------------------
// webviewProtocol.ts — Type definitions for Extension Host ↔ Webview messages
//
// All messages passed via VS Code's postMessage API between the extension
// host process and the webview iframe.
// ---------------------------------------------------------------------------

// ── Extension Host → Webview ──────────────────────────────────────────────

export interface UsageInfo {
  calls: number;
  input: number;
  output: number;
  cache: number;
  total: number;
  cost_usd?: number;
}

export type WebviewOutboundMessage =
  | { type: 'webviewReady' }
  // Streaming
  | { type: 'messageDelta'; text: string; sessionId: string }
  | { type: 'messageComplete'; text: string; usage?: UsageInfo; sessionId: string }
  // Session
  | { type: 'sessionHistory'; messages: TranscriptMessage[]; sessionId: string }
  | { type: 'sessionList'; sessions: SessionSummary[] }
  | { type: 'sessionSwitched'; sessionId: string; title: string }
  // Tools
  | { type: 'toolStart'; toolId: string; name: string; args?: string }
  | { type: 'toolComplete'; toolId: string; name: string; durationMs: number; error?: string }
  // Permissions
  | { type: 'approvalRequest'; requestId: string; command: string; description: string }
  // Status
  | { type: 'statusUpdate'; status: 'thinking' | 'generating' | 'running_tool' | 'ready' | 'error'; message?: string; sessionId: string }
  // Config
  | { type: 'configUpdate'; config: WebviewConfig }
  // Error
  | { type: 'errorMessage'; message: string }
  // Theme
  | { type: 'themeChange'; kind: 'dark' | 'light' };

export interface TranscriptMessage {
  role: 'assistant' | 'system' | 'tool' | 'user';
  text: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  messageCount: number;
  startedAt: number;
}

export interface WebviewConfig {
  model: string;
  provider: string;
  permissionMode: 'plan' | 'ask' | 'auto';
}

// ── Webview → Extension Host ──────────────────────────────────────────────

export type WebviewInboundMessage =
  | { type: 'submitPrompt'; text: string }
  | { type: 'interrupt' }
  | { type: 'approvalRespond'; requestId: string; allowed: boolean }
  | { type: 'newSession' }
  | { type: 'selectSession'; sessionId: string }
  | { type: 'setPermissionMode'; mode: 'plan' | 'ask' | 'auto' }
  | { type: 'listSessions' }
  | { type: 'openFile'; path: string }
  | { type: 'webviewReady' };
