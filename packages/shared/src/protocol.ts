/**
 * Agent-Client communication protocol definitions.
 *
 * Defines the message types exchanged between the Agent runtime and the TUI/CLI client.
 * Core types (AssistantMessage, UserMessage, etc.) are imported from ./types/ to avoid
 * duplication.
 */

import type {
  AssistantMessage,
  CompactMetadata,
  StreamEvent,
  ToolProgress,
  UserMessage,
} from './types/message.js';

// ---------------------------------------------------------------------------
// Re-export core types for protocol consumers
// ---------------------------------------------------------------------------

export type {
  AssistantMessage,
  CompactMetadata,
  StreamEvent,
  ToolProgress,
  UserMessage,
};

// ---------------------------------------------------------------------------
// Agent → Client Messages
// ---------------------------------------------------------------------------

type ProtocolQueryMessage =
  | { type: 'stream_event'; event: StreamEvent }
  | { type: 'assistant'; message: AssistantMessage }
  | { type: 'user'; message: UserMessage }
  | { type: 'system'; subtype: 'compact_boundary'; compactMetadata: CompactMetadata }
  | { type: 'error'; error: ProtocolAgentError }
  | { type: 'progress'; data: ToolProgress };

export interface ProtocolAgentError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Agent ↔ Client Envelope
// ---------------------------------------------------------------------------

export interface AgentMessageEnvelope {
  id: string;
  type: string;
  timestamp: string;
  sessionId: string;
  payload: unknown;
}

export interface ClientMessageEnvelope {
  id: string;
  type: string;
  timestamp: string;
  payload: unknown;
}

// ---------------------------------------------------------------------------
// Transport Types
// ---------------------------------------------------------------------------

export type TransportType = 'sse' | 'stdio' | 'websocket';

export interface TransportConfig {
  type: TransportType;
  url?: string;
  command?: string;
  args?: string[];
}

// ---------------------------------------------------------------------------
// Permission Request (protocol-level)
// ---------------------------------------------------------------------------

export interface PermissionRequestMessage {
  requestId: string;
  toolName: string;
  toolInput: unknown;
  riskLevel: string;
  message: string;
  options: PermissionOption[];
}

export interface PermissionOption {
  label: string;
  value: 'approve' | 'deny' | 'always_approve' | 'always_deny';
  description?: string;
}

// ---------------------------------------------------------------------------
// Completion Message
// ---------------------------------------------------------------------------

export interface CompletionMessage {
  success: boolean;
  summary: string;
  totalCost: number;
  totalTurns: number;
  totalTokens: number;
  error?: string;
}
