import type Anthropic from '@anthropic-ai/sdk';

/**
 * Tool Plugin Contract
 *
 * Every tool implements this interface.  The tool registry auto-discovers
 * plugins and builds lookup tables for schema, execution, and rendering.
 *
 * To add a new tool:
 *   1. cp -r tools/_template tools/my-tool
 *   2. Edit schema.ts, executor.ts, renderer.tsx
 *   3. Import and register in registry.ts
 */

// ── Schema ────────────────────────────────────────────────────────

export interface ToolMeta {
  riskLevel: 'safe' | 'mutation' | 'destructive';
  /** When true, this tool can execute concurrently with other safe tools. */
  isConcurrencySafe?: boolean;
}

/** Anthropic tool definition + our metadata. */
export type ToolSchema = Anthropic.Tool & { _meta: ToolMeta };

// ── Executor ──────────────────────────────────────────────────────

export interface ToolResult {
  content: string;
  isError: boolean;
  /** Execution duration in milliseconds. */
  duration?: number;
  /** Tool-specific structured metadata (e.g. stderr, exitCode, filePath). */
  metadata?: Record<string, unknown>;
}

export interface ExecutorOptions {
  cwd?: string;
  allowMutation?: boolean;
  maxOutput?: number;
  bashTimeout?: number;
  agentSpawn?: import('../core/types.js').AgentSpawnContext | undefined;
  /** Session ID for resolving the task list directory. */
  sessionId?: string;
}

/** Executor options with all core fields resolved (non-optional) but agentSpawn kept optional. */
export type ResolvedExecutorOptions = Required<Omit<ExecutorOptions, 'agentSpawn' | 'sessionId'>> &
  Pick<ExecutorOptions, 'agentSpawn' | 'sessionId'>;

export type ToolExecutor = (
  input: Record<string, unknown>,
  options: ResolvedExecutorOptions,
) => Promise<ToolResult>;

// ── Renderer ──────────────────────────────────────────────────────

export interface ToolUseRendererProps {
  toolName: string;
  toolId: string;
  input: Record<string, unknown>;
  paramSummary?: string;
  state: 'pending' | 'executing' | 'done' | 'error';
  riskLevel?: 'safe' | 'mutation' | 'destructive';
  permissionState?: 'approved' | 'denied' | 'pending';
  duration?: number;
  expanded?: boolean;
  onToggle?: () => void;
  children?: React.ReactNode;
  /** Tool execution result (injected after execution for inline display). */
  result?: {
    content: string;
    isError: boolean;
    metadata?: Record<string, unknown>;
  };
  /** Global content expansion toggle (Ctrl+D). When true, show full output. */
  contentExpanded?: boolean;
}

export interface ToolResultRendererProps {
  content: string;
  isError: boolean;
  truncated?: boolean;
  collapseThreshold?: number;
  /** Execution duration in milliseconds. When present, renderers should display it. */
  duration?: number;
  /** The tool name — allows result renderers to adapt behavior per tool. */
  toolName?: string;
  /** Tool-specific metadata from the executor (e.g. stderr, exitCode, filePath). */
  metadata?: Record<string, unknown>;
  /** Global content expansion toggle (Ctrl+D). When true, show full output. */
  contentExpanded?: boolean;
}

export type ToolUseRenderer = (props: ToolUseRendererProps) => React.ReactNode;
export type ToolResultRenderer = (props: ToolResultRendererProps) => React.ReactNode;

// ── Plugin ────────────────────────────────────────────────────────

export interface ToolPlugin {
  /** Unique tool name matching the Anthropic schema name. */
  name: string;
  /** Anthropic tool definition + _meta. */
  schema: ToolSchema;
  /** Execution function. */
  executor: ToolExecutor;
  /** Custom tool-use block renderer. Falls back to GenericRenderer. */
  useRenderer?: ToolUseRenderer;
  /** Custom tool-result block renderer. Falls back to GenericResultRenderer. */
  resultRenderer?: ToolResultRenderer;
  /** Extract a human-readable param summary from tool input, e.g. "src/App.tsx". */
  paramSummary?: (input: Record<string, unknown>) => string | undefined;
  /** When false, this tool is excluded from LLM tool definitions and execution. Default: true. */
  isEnabled?: () => boolean;
}
