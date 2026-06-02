/**
 * Configuration types — Kode Agent configuration system.
 *
 * Priority (highest to lowest):
 *   CLI args > Environment variables > ~/.kode/settings.json > Default values
 */

import { PermissionMode } from './permission.js';

// ---------------------------------------------------------------------------
// KodeConfig — Root configuration
// ---------------------------------------------------------------------------

export interface KodeConfig {
  /** API key for the provider (resolved from env or config file) */
  apiKey?: string;
  /** Base URL override for the provider */
  baseUrl?: string;
  /** Model configuration */
  model: ModelConfig;
  /** Permission system configuration */
  permissions: PermissionConfig;
  /** Tool system configuration */
  tools: ToolConfig;
  /** Context management configuration */
  context: ContextConfig;
  /** Hook system configuration */
  hooks: HookConfig;
  /** MCP (Model Context Protocol) configuration */
  mcp: McpConfig;
  /** User-level settings */
  user?: UserConfig;
  /** CLI-specific settings */
  cli?: CliConfig;
}

// ---------------------------------------------------------------------------
// Model Configuration
// ---------------------------------------------------------------------------

export interface ModelConfig {
  /** Provider identifier (anthropic, openai, deepseek) */
  provider: 'anthropic' | 'openai' | 'deepseek' | string;
  /** Model identifier (claude-sonnet-4-6, gpt-4o, deepseek-chat) */
  model: string;
  /** Maximum tokens for the response */
  maxTokens?: number;
  /** Temperature (0–1) */
  temperature?: number;
  /** Extended thinking configuration */
  thinking?: ThinkingConfig;
  /** Provider-specific options */
  providerOptions?: Record<string, unknown>;
}

export interface ThinkingConfig {
  /** Thinking mode */
  mode: 'enabled' | 'adaptive' | 'disabled';
  /** Budget in tokens for thinking */
  budgetTokens?: number;
}

// ---------------------------------------------------------------------------
// Permission Configuration
// ---------------------------------------------------------------------------

export interface PermissionConfig {
  /** Default permission mode */
  mode: PermissionMode;
  /** Directories that are trusted for AUTO mode */
  trustedDirectories: string[];
  /** Auto mode classifier configuration */
  autoMode?: {
    enabled: boolean;
    /** Threshold for auto-classifying as safe */
    confidenceThreshold?: number;
  };
  /** Rules for specific tools */
  toolRules?: ToolPermissionRule[];
}

export interface ToolPermissionRule {
  toolName: string;
  /** Override risk level for this tool */
  riskLevel?: 'safe' | 'mutation' | 'destructive';
  /** Always allow (even in PLAN mode) */
  alwaysAllow?: boolean;
  /** Always deny (even in AUTO mode) */
  alwaysDeny?: boolean;
  /** Require confirmation in ALL modes */
  alwaysAsk?: boolean;
}

// ---------------------------------------------------------------------------
// Tool Configuration
// ---------------------------------------------------------------------------

export interface ToolConfig {
  /** List of disabled tool names */
  disabled: string[];
  /** Bash tool configuration */
  bash?: {
    timeout: number;
    /** Shell to use (default: /bin/bash) */
    shell?: string;
    /** Maximum output size in bytes */
    maxOutputBytes?: number;
  };
  /** Web tools configuration */
  web?: {
    enabled: boolean;
    /** User-Agent string for web requests */
    userAgent?: string;
  };
  /** File tools configuration */
  file?: {
    /** Maximum file size to read in bytes */
    maxReadSizeBytes?: number;
  };
  /** Tool-specific overrides */
  toolOverrides?: Record<string, Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Context Configuration
// ---------------------------------------------------------------------------

export interface ContextConfig {
  /** Maximum context budget in tokens */
  budget: number;
  /** Threshold (0–1) at which compaction triggers */
  compactThreshold: number;
  /** Compaction strategy preference */
  compactStrategy?: 'snip' | 'auto';
  /** Maximum number of conversation turns */
  maxTurns?: number;
  /** Maximum cost budget in USD */
  maxBudgetUsd?: number;
}

// ---------------------------------------------------------------------------
// Hook Configuration
// ---------------------------------------------------------------------------

export interface HookConfig {
  /** Directories containing hook definitions */
  paths: string[];
  /** Default timeout for hook execution (ms) */
  defaultTimeout?: number;
  /** Built-in hooks to enable/disable */
  builtin?: HookBuiltinConfig;
}

export interface HookBuiltinConfig {
  /** Auto-format on file write */
  autoFormat?: boolean;
  /** Git commit on file changes */
  autoCommit?: boolean;
  /** Block dangerous commands */
  blockDangerous?: boolean;
}

// ---------------------------------------------------------------------------
// MCP Configuration
// ---------------------------------------------------------------------------

export interface McpConfig {
  /** MCP server configurations */
  servers: McpServerConfig[];
  /** MCP client timeout (ms) */
  timeout?: number;
}

export interface McpServerConfig {
  /** Server name (identifier) */
  name: string;
  /** Command to start the server */
  command: string;
  /** Arguments for the command */
  args: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Whether this server is enabled */
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// User Configuration
// ---------------------------------------------------------------------------

export interface UserConfig {
  /** User name (for personalization) */
  name?: string;
  /** Preferred language */
  language?: string;
  /** Custom system prompt additions */
  customPrompt?: string;
  /** Additional system prompt to append */
  appendSystemPrompt?: string;
}

// ---------------------------------------------------------------------------
// CLI Configuration
// ---------------------------------------------------------------------------

export interface CliConfig {
  /** Color theme */
  theme?: 'dark' | 'light' | 'system';
  /** Default output mode */
  outputMode?: 'interactive' | 'print' | 'stream-json';
  /** Keyboard shortcut overrides */
  keybindings?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Default Configuration
// ---------------------------------------------------------------------------

export const DEFAULT_KODE_CONFIG: KodeConfig = {
  model: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    maxTokens: 8192,
    thinking: {
      mode: 'adaptive',
      budgetTokens: 16000,
    },
  },
  permissions: {
    mode: PermissionMode.ASK,
    trustedDirectories: [],
    autoMode: {
      enabled: false,
    },
  },
  tools: {
    disabled: [],
    bash: {
      timeout: 120,
    },
    web: {
      enabled: true,
    },
  },
  context: {
    budget: 200000,
    compactThreshold: 0.6,
  },
  hooks: {
    paths: [],
    defaultTimeout: 5000,
  },
  mcp: {
    servers: [],
    timeout: 30000,
  },
  cli: {
    theme: 'dark',
    outputMode: 'interactive',
  },
};
