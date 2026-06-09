/**
 * Provider-internal message types — decoupled from the TUI message model.
 * These match the CoderAgent @coder/shared types that the provider layer expects.
 */

// ---------------------------------------------------------------------------
// Content Block (API-level, not TUI-level)
// ---------------------------------------------------------------------------

export interface ProviderContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image' | 'thinking';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | { type: 'text'; text: string }[];
  is_error?: boolean;
  source?: ProviderImageSource;
  thinking?: string;
  signature?: string;
}

export interface ProviderImageSource {
  type: 'base64' | 'url';
  media_type: string;
  data?: string;
  url?: string;
}

// ---------------------------------------------------------------------------
// Message (API-level)
// ---------------------------------------------------------------------------

export interface ProviderMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | ProviderContentBlock[];
}

// ---------------------------------------------------------------------------
// Tool Definition (JSON Schema based)
// ---------------------------------------------------------------------------

export interface ProviderToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
    [key: string]: unknown;
  };
}
