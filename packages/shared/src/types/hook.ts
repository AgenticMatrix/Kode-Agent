/**
 * Hook types — the extension mechanism for the Agent lifecycle.
 *
 * Hooks execute user-defined logic at key points in the Agent Loop
 * without modifying the loop itself. They can inject context, block
 * tool use, trigger side effects, and request early termination.
 *
 * 13 Hook events (Phase 5 expanded from 8):
 *   SessionStart → [Agent Loop: PreToolUse → PostToolUse | PostToolUseFailure] × N
 *     → Stop | StopFailure → SessionEnd
 *   SubagentStart → [Sub-agent Loop] → SubagentStop
 *   TaskCreated → [Task execution] → TaskCompleted
 *   PreCompact (fires before context compression)
 *   Notification (system-level events: tool done, compact done, errors)
 *   UserPromptSubmit (user input intercepted before Agent Loop, blockable)
 *   PreMessage (messages about to be sent to LLM API, blockable)
 *   PostMessage (LLM response received, non-blockable observability)
 */

import type { Message, AssistantMessage } from './message.js';

// ---------------------------------------------------------------------------
// Hook Events
// ---------------------------------------------------------------------------

/**
 * The eight hook events matching Claude Code's hook system.
 *
 * Lifecycle order:
 *   SessionStart → [Agent Loop: PreToolUse → PostToolUse] × N → Stop → SessionEnd
 *   SubagentStart → [Sub-agent Loop] → SubagentStop
 *   PreCompact (fires before context compression)
 *
 * Phase 5 additions (Sprint 7):
 *   PostToolUseFailure — tool execution threw an exception
 *   StopFailure — API error caused abnormal loop termination
 *   TaskCreated — background task / sub-agent spawned
 *   TaskCompleted — background task / sub-agent finished
 *   Notification — system-level event notification (non-blocking)
 *   UserPromptSubmit — user input intercepted before entering Agent Loop (blockable)
 *   PreMessage — messages about to be sent to LLM API (blockable)
 *   PostMessage — LLM response received (non-blockable, observability)
 */
export type HookEvent =
  | 'SessionStart'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Stop'
  | 'StopFailure'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'
  | 'SessionEnd'
  | 'TaskCreated'
  | 'TaskCompleted'
  | 'Notification'
  | 'UserPromptSubmit'
  | 'PreMessage'
  | 'PostMessage'
  // ── P1: Important scenario hooks ──
  | 'PostCompact'
  | 'InstructionsLoaded'
  | 'PermissionRequest'
  | 'PermissionDenied'
  | 'WorktreeCreate'
  | 'WorktreeRemove'
  | 'PostToolBatch'
  // ── P2: Configuration & Environment hooks ──
  | 'ConfigChange'
  | 'Setup'
  | 'CwdChanged'
  | 'UserPromptExpansion';

// ---------------------------------------------------------------------------
// Hook Context (data passed to the handler)
// ---------------------------------------------------------------------------

export interface BaseHookContext {
  event: HookEvent;
  sessionId: string;
  cwd: string;
  timestamp: Date;
}

export interface SessionStartContext extends BaseHookContext {
  event: 'SessionStart';
}

export interface PreToolUseContext extends BaseHookContext {
  event: 'PreToolUse';
  toolName: string;
  input: unknown;
  /** The raw input before validation */
  rawInput: unknown;
}

export interface PostToolUseContext extends BaseHookContext {
  event: 'PostToolUse';
  toolName: string;
  input: unknown;
  result: unknown;
  success: boolean;
  durationMs: number;
}

export interface StopContext extends BaseHookContext {
  event: 'Stop';
  turnCount: number;
  /** Last N messages for inspection (N = 5) */
  recentMessages: Array<{ role: string; summary: string }>;
}

export interface SubagentStartContext extends BaseHookContext {
  event: 'SubagentStart';
  subagentName: string;
  subagentPrompt: string;
  allowedTools: string[];
}

export interface SubagentStopContext extends BaseHookContext {
  event: 'SubagentStop';
  subagentName: string;
  success: boolean;
  summary: string;
  tokenUsage: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Phase 5: New Hook Contexts (Sprint 7)
// ---------------------------------------------------------------------------

/**
 * Fires when a tool execution throws an exception (catch block in query.ts).
 * Non-blockable — the tool has already failed, this hook is for observability.
 */
export interface PostToolUseFailureContext extends BaseHookContext {
  event: 'PostToolUseFailure';
  /** Name of the tool that failed */
  toolName: string;
  /** The tool input that was passed */
  input: unknown;
  /** Error details */
  error: {
    message: string;
    stack?: string;
  };
}

/**
 * Fires when an API error causes the Agent Loop to terminate abnormally.
 * Non-blockable — the loop has already failed, this hook is for diagnostics.
 */
export interface StopFailureContext extends BaseHookContext {
  event: 'StopFailure';
  /** Error details from the API call failure */
  error: {
    message: string;
    code?: string;
    status?: number;
  };
  /** How many turns had been completed before the failure */
  turnCount: number;
}

/**
 * Fires when a background task / sub-agent is spawned (SubagentBus.spawn).
 * Non-blockable — the task has already been queued, this hook is for tracking.
 */
export interface TaskCreatedContext extends BaseHookContext {
  event: 'TaskCreated';
  /** Unique identifier of the spawned task / sub-agent */
  taskId: string;
  /** Type of task: 'subagent', 'cron', 'background' */
  taskType: 'subagent' | 'cron' | 'background';
  /** Task prompt / description (truncated to 500 chars) */
  prompt?: string;
  /** Allowed tool set for this task (empty = unrestricted) */
  toolSet?: string[];
}

/**
 * Fires when a background task / sub-agent completes (SubagentBus onCompleted).
 * Non-blockable — the task has already finished, this hook is for observability.
 */
export interface TaskCompletedContext extends BaseHookContext {
  event: 'TaskCompleted';
  /** Unique identifier of the completed task */
  taskId: string;
  /** Final status */
  status: 'completed' | 'failed' | 'killed';
  /** Human-readable summary of what the task accomplished */
  summary?: string;
  /** Resource usage metrics */
  usage?: {
    tokens: number;
    toolCalls: number;
    durationMs: number;
  };
}

/**
 * Fires for system-level event notifications (tool completion, compaction,
 * errors). Non-blockable — purely informational, allows hooks to log,
 * notify desktop, etc.
 */
export interface NotificationContext extends BaseHookContext {
  event: 'Notification';
  /** Severity level */
  level: 'info' | 'warn' | 'error';
  /** Human-readable message */
  message: string;
  /** Optional structured metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Fires when the user submits a prompt in the TUI, BEFORE it enters the
 * Agent Loop. This is the first blockable P0 event — hooks can intercept
 * dangerous commands, augment the prompt with project context, or block
 * the submission entirely.
 *
 * Integration point: QueryEngine.submitMessage() entry (query-engine.ts).
 */
export interface UserPromptSubmitContext extends BaseHookContext {
  event: 'UserPromptSubmit';
  /** The raw user input text */
  prompt: string;
  /** Optional metadata about the current session state */
  metadata?: {
    model?: string;
    provider?: string;
  };
}

/**
 * Fires BEFORE a message batch is sent to the LLM API. Hooks can inject
 * additional system context, modify the messages, or block the API call.
 *
 * Integration point: query.ts, after systemPrompt assembly and before
 * callModel(messages, ...).
 *
 * Perf: messages is limited to the last 10 entries for shell hooks
 * (see HookManager.executeShellHook for truncation logic).
 */
export interface PreMessageContext extends BaseHookContext {
  event: 'PreMessage';
  /** Messages about to be sent (last 10 for shell hooks, full for function hooks) */
  messages: Message[];
  /** The assembled system prompt */
  systemPrompt: string;
  /** Model being used for this API call */
  model: string;
  /** Current turn count */
  turnCount: number;
}

/**
 * Fires AFTER an LLM response is received and assembled into an
 * AssistantMessage. Non-blockable — the response has already been
 * consumed. Hooks can extract knowledge, update memory, or inject
 * context for the next turn.
 *
 * Integration point: query.ts, after assistantMsg assembly, before
 * the Stop hook.
 */
export interface PostMessageContext extends BaseHookContext {
  event: 'PostMessage';
  /** The assembled assistant message from the LLM */
  message: AssistantMessage;
  /** Messages sent in this API call (last 10 for shell hooks, full for function hooks) */
  messages: Message[];
  /** Model that generated the response */
  model: string;
  /** Current turn count */
  turnCount: number;
  /** Token usage for this API call */
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ---------------------------------------------------------------------------
// Phase 5 P1: Important Scenario Hook Contexts (Sprint 7)
// ---------------------------------------------------------------------------

/**
 * Fires after context compaction completes. Non-blockable — compaction
 * has already finished. Hooks can log the compaction event or adjust
 * metadata tracking.
 */
export interface PostCompactContext extends BaseHookContext {
  event: 'PostCompact';
  /** Strategy used for compaction */
  strategy: string;
  /** Token count before compaction */
  beforeTokens: number;
  /** Token count after compaction */
  afterTokens: number;
  /** Number of messages removed */
  messagesRemoved: number;
}

/**
 * Fires after the System Prompt assembler completes. Non-blockable —
 * the prompt is already assembled. Hooks can log what was loaded
 * (CODER.md, MEMORY, Skills, etc.) for diagnostics.
 */
export interface InstructionsLoadedContext extends BaseHookContext {
  event: 'InstructionsLoaded';
  /** Sources that contributed to the system prompt */
  sources: string[];
  /** Total token count of the assembled prompt */
  totalTokens: number;
}

/**
 * Fires BEFORE a permission decision is made. BLOCKABLE — hooks can
 * override the permission result to auto-approve or auto-deny.
 *
 * Integration point: PermissionEngine.check().
 */
export interface PermissionRequestContext extends BaseHookContext {
  event: 'PermissionRequest';
  /** Name of the tool requesting permission */
  toolName: string;
  /** The tool input being checked */
  input: unknown;
  /** The risk level of this operation */
  riskLevel: string;
  /** Original permission decision (what would happen without hook) */
  originalBehavior: 'approve' | 'deny' | 'ask_user';
}

/**
 * Fires when permission is denied. Non-blockable — the denial has
 * already occurred. Hooks can log denials for audit purposes.
 */
export interface PermissionDeniedContext extends BaseHookContext {
  event: 'PermissionDenied';
  /** Name of the tool that was denied */
  toolName: string;
  /** The tool input that was rejected */
  input: unknown;
  /** The reason for denial */
  reason: string;
}

/**
 * Fires BEFORE a git worktree is created. BLOCKABLE — hooks can
 * prevent worktree creation for security or resource reasons.
 *
 * Integration point: EnterWorktree tool execute().
 */
export interface WorktreeCreateContext extends BaseHookContext {
  event: 'WorktreeCreate';
  /** Name of the worktree being created */
  name: string;
  /** The base ref (branch/commit) for the new worktree */
  baseRef: string;
}

/**
 * Fires when a worktree is being removed. Non-blockable — the
 * removal has already been decided. Hooks can log or trigger
 * cleanup tasks before the directory is deleted.
 */
export interface WorktreeRemoveContext extends BaseHookContext {
  event: 'WorktreeRemove';
  /** Name of the worktree being removed */
  name: string;
  /** Whether the worktree content is being kept */
  kept: boolean;
}

/**
 * Fires after a batch of tool executions completes. BLOCKABLE —
 * hooks can prevent further execution or inject additional context
 * based on the batch results.
 *
 * Integration point: query.ts after tool processing loop.
 */
export interface PostToolBatchContext extends BaseHookContext {
  event: 'PostToolBatch';
  /** Results of each tool in the batch */
  toolResults: Array<{
    toolName: string;
    success: boolean;
    durationMs: number;
    summary: string;
  }>;
}

// ---------------------------------------------------------------------------
// Phase 5 P2: Configuration & Environment Hook Contexts (Sprint 7)
// ---------------------------------------------------------------------------

/**
 * Fires when the configuration changes (--system-prompt, model switch,
 * permission mode change, API key rotation, etc.). Non-blockable —
 * the config has already been applied. Hooks can log changes or
 * trigger side effects (e.g. notify desktop).
 *
 * Integration point: QueryEngine when config options are set/changed.
 */
export interface ConfigChangeContext extends BaseHookContext {
  event: 'ConfigChange';
  /** Which config fields changed */
  changedKeys: string[];
  /** New values for changed keys */
  newValues: Record<string, unknown>;
  /** Previous values (where tracked) */
  previousValues?: Record<string, unknown>;
}

/**
 * Fires when a new session is created for the first time. Non-blockable —
 * the session already exists. Hooks can run one-time setup tasks:
 * create directories, install dependencies, initialize project files.
 *
 * Integration point: QueryEngine constructor or init() on first session.
 */
export interface SetupContext extends BaseHookContext {
  event: 'Setup';
  /** Whether this is a fresh session (no prior message history) */
  isFresh: boolean;
  /** Session model/provider info */
  model?: string;
  provider?: string;
}

/**
 * Fires when the working directory changes (e.g. cd command, --cwd flag).
 * Non-blockable — the directory has already changed. Hooks can
 * reload project-specific config or update environment.
 *
 * Integration point: QueryEngine / engine-factory when cwd is updated.
 */
export interface CwdChangedContext extends BaseHookContext {
  event: 'CwdChanged';
  /** Previous working directory */
  previousCwd: string;
  /** New working directory */
  newCwd: string;
}

/**
 * Fires after UserPromptSubmit and prompt expansion, before the expanded
 * prompt enters the Agent Loop. BLOCKABLE — hooks can intercept the final
 * prompt before it's sent to the model.
 *
 * Integration point: QueryEngine.submitMessage() after UserPromptSubmit.
 */
export interface UserPromptExpansionContext extends BaseHookContext {
  event: 'UserPromptExpansion';
  /** The original user input before expansion */
  originalPrompt: string;
  /** The expanded/augmented prompt (may be same as original) */
  expandedPrompt: string;
}

export interface PreCompactContext extends BaseHookContext {
  event: 'PreCompact';
  messageCount: number;
  currentTokens: number;
  budgetTokens: number;
  strategy: 'snip' | 'auto' | 'summarize';
}

export interface SessionEndContext extends BaseHookContext {
  event: 'SessionEnd';
  turnCount: number;
  totalCost: number;
  totalTokens: number;
}

export type HookContext =
  | SessionStartContext
  | PreToolUseContext
  | PostToolUseContext
  | PostToolUseFailureContext
  | StopContext
  | StopFailureContext
  | SubagentStartContext
  | SubagentStopContext
  | PreCompactContext
  | SessionEndContext
  | TaskCreatedContext
  | TaskCompletedContext
  | NotificationContext
  | UserPromptSubmitContext
  | PreMessageContext
  | PostMessageContext
  | PostCompactContext
  | InstructionsLoadedContext
  | PermissionRequestContext
  | PermissionDeniedContext
  | WorktreeCreateContext
  | WorktreeRemoveContext
  | PostToolBatchContext
  | ConfigChangeContext
  | SetupContext
  | CwdChangedContext
  | UserPromptExpansionContext;

// ---------------------------------------------------------------------------
// Hook Result
// ---------------------------------------------------------------------------

/**
 * Returned by hook handlers. Different events expect different fields.
 *
 * Common pattern:
 *   - PreToolUse: can block tool execution
 *   - Stop: can request agent pause
 *   - SessionStart: can inject additional context
 */
export interface HookResult {
  /** If true, the operation is blocked (PreToolUse, UserPromptSubmit, PreMessage) */
  blocked?: boolean;
  /** Reason for blocking — shown to the user */
  reason?: string;
  /** Additional context to inject into the system prompt (SessionStart, PreCompact, PostMessage) */
  injectContext?: string;
  /** Request the agent to stop (Stop event) */
  shouldStop?: boolean;
  /** Modify system prompt parts (SessionStart) */
  systemPromptAdditions?: string[];
  /** Extra data passed between hooks */
  metadata?: Record<string, unknown>;

  // ── UserPromptSubmit result fields ──────────────────────────────
  /** Augmented/replacement prompt (UserPromptSubmit) */
  augmentedPrompt?: string;

  // ── PreMessage result fields ─────────────────────────────────────
  /** Modified system prompt to use for this API call (PreMessage) */
  modifiedSystemPrompt?: string;

  // ── PostMessage result fields ────────────────────────────────────
  /** Save this text to the agent's memory store (PostMessage) */
  saveToMemory?: string;

  // ── PermissionRequest result fields ───────────────────────────────
  /** Override the permission check result (PermissionRequest): 'auto-approve' or 'auto-deny' */
  permissionOverride?: 'auto-approve' | 'auto-deny';

  // ── WorktreeCreate result fields ──────────────────────────────────
  /** Override the worktree name (WorktreeCreate) */
  worktreeName?: string;

  // ── UserPromptExpansion result fields ───────────────────────────────
  /** Override the expanded prompt (UserPromptExpansion) */
  expandedPromptOverride?: string;
}

// ---------------------------------------------------------------------------
// Hook Definition
// ---------------------------------------------------------------------------

/**
 * A hook is a handler registered for a specific lifecycle event.
 *
 * Handlers can be:
 *   1. Shell commands (string) — executed as subprocesses
 *   2. TypeScript functions — executed in-process
 *   3. HTTP endpoints (HttpHookConfig) — POST hook context to URL
 *   4. MCP tools (McpToolHookConfig) — invoke MCP tool on event
 *
 * The handler type is determined by the `type` field:
 *   - 'command' (default): handler is a shell command string
 *   - 'function': handler is an in-process async function
 *   - 'http': handler is an HttpHookConfig
 *   - 'mcp_tool': handler is an McpToolHookConfig
 */
export interface Hook {
  /** Unique identifier for this hook */
  id: string;
  /** The lifecycle event this hook listens to */
  event: HookEvent;
  /** Human-readable description */
  description?: string;
  /** Handler type — determines how handler is interpreted */
  type?: 'command' | 'function' | 'http' | 'mcp_tool';
  /** Shell command, in-process function, or config object depending on type */
  handler: string | ((ctx: HookContext) => Promise<HookResult>) | HttpHookConfig | McpToolHookConfig;
  /** Timeout in milliseconds (default: 5000) */
  timeout?: number;
  /** Whether this hook is enabled */
  enabled?: boolean;
  /** Priority — higher numbers execute first (default: 0) */
  priority?: number;
}

/**
 * Hook type enum — matches Claude Code's hook types.
 */
export type HookType = 'command' | 'function' | 'http' | 'mcp_tool';

/**
 * Configuration for HTTP hook type.
 * When a hook event fires, the HookManager POSTs the serialized context
 * to the configured URL with a JSON body.
 */
export interface HttpHookConfig {
  /** URL to POST the hook context to */
  url: string;
  /** HTTP method (default: POST) */
  method?: 'GET' | 'POST' | 'PUT';
  /** Custom HTTP headers */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds (default: 5000) */
  timeout?: number;
  /** Whether to include the full context body (default: true) */
  includeContext?: boolean;
}

/**
 * Configuration for MCP tool hook type.
 * When a hook event fires, the HookManager invokes the specified MCP tool
 * via the MCP client with the serialized context as arguments.
 *
 * Stub implementation — actual MCP invocation is deferred to MCP enhancement phase.
 */
export interface McpToolHookConfig {
  /** MCP server name */
  serverName: string;
  /** MCP tool name to invoke */
  toolName: string;
  /** Extra arguments to pass to the MCP tool */
  args?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Hook Manager Interface
// ---------------------------------------------------------------------------

export interface HookManagerLike {
  /** Register a new hook */
  register(hook: Hook): void;
  /** Remove a hook by ID */
  unregister(hookId: string): void;
  /** Execute all registered hooks for an event. Returns aggregated results. */
  execute(event: HookEvent, ctx: Partial<HookContext>): Promise<HookResult[]>;
  /** Synchronous execution for SessionStart (used during system prompt assembly) */
  executeSync(event: 'SessionStart', ctx: Partial<SessionStartContext>): HookResult[];
  /** List all registered hooks */
  list(): Hook[];
}
