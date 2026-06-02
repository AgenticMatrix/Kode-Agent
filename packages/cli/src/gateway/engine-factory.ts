/**
 * engine-factory.ts — Create a fully configured QueryEngine for the CLI.
 *
 * Wires together all the dependencies needed by the Agent Loop:
 * - Provider (Anthropic via API key from env)
 * - ToolRegistry (all 31 core tools registered)
 * - SessionManager + CheckpointManager (persistence layer)
 * - PermissionEngine (Plan / Ask / Auto modes)
 * - SystemPromptAssembler (dynamic prompt assembly)
 *
 * Usage:
 *   const { engine, interrupt } = createQueryEngine('/path/to/project');
 *   for await (const event of engine.submitMessage('fix the bug')) {
 *     // handle QueryEngineEvent
 *   }
 *   // or call interrupt() to abort
 */

import { randomUUID } from 'node:crypto';

import {
  AnthropicProvider,
  OpenAICompatProvider,
  DeepSeekProvider,
  ProviderRouter,
} from '@kode/provider';
import type { Provider, ProviderConfig } from '@kode/provider';
import {
  QueryEngine,
  ToolRegistry,
  SessionManager,
  CheckpointManager,
  SystemPromptAssembler,
  HookManager,
  CronScheduler,
  setCronScheduler,
  getCronScheduler,
} from '@kode/core';
import type { QueryEngineEvent } from '@kode/core';
import {
  BashTool,
  ReadTool,
  WriteTool,
  EditTool,
  GlobTool,
  GrepTool,
  GitTool,
  TodoWriteTool,
  TaskCreateTool,
  TaskUpdateTool,
  TaskListTool,
  TaskDescribeTool,
  TaskOutputTool,
  WebFetchTool,
  WebSearchTool,
  AskUserQuestionTool,
  ExitPlanModeTool,
  NotebookEditTool,
  LSPTool,
  AgentSpawnTool,
  AgentReadTool,
  AgentMessageTool,
  AgentStopTool,
  SkillTool,
  TeamCreateTool,
  TeamDeleteTool,
  CronCreateTool,
  CronDeleteTool,
  CronListTool,
  EnterWorktreeTool,
  ExitWorktreeTool,
} from '@kode/tools';
import type { BaseTool } from '@kode/shared';

// ---------------------------------------------------------------------------
// Factory options
// ---------------------------------------------------------------------------

export interface EngineFactoryOptions {
  /** Working directory for the agent (default: process.cwd()) */
  cwd?: string;
  /** API key override (default: process.env.ANTHROPIC_API_KEY) */
  apiKey?: string;
  /** Base URL override for the provider */
  baseUrl?: string;
  /** Model identifier (default: from env or 'claude-sonnet-4-6') */
  model?: string;
  /** Provider name: "anthropic" | "openai" | "deepseek" | "auto" (default: "anthropic") */
  providerName?: string;
  /** Maximum turns per interaction (default: 100) */
  maxTurns?: number;
  /** Maximum budget in USD (default: no limit) */
  maxBudgetUsd?: number;
  /** Context window budget in tokens (default: 180_000) */
  contextBudget?: number;
  /** Compaction threshold ratio (default: 0.7) */
  compactThreshold?: number;
  /** Custom system prompt (replaces default) */
  customSystemPrompt?: string;
  /** Append to system prompt */
  appendSystemPrompt?: string;
  /** Explicit session ID (default: random UUID). MUST match the gateway session ID
   *  returned by session.create RPC, otherwise TUI filters out all bridge events. */
  sessionId?: string;
  /** Optional SubagentBus for tracking background sub-agents */
  subagentBus?: import('@kode/shared').SubagentBus;
  /** Enable Coordinator mode (default: false) */
  coordinatorMode?: boolean;
  /** Worker role: only meaningful when coordinatorMode=false (default: undefined) */
  workerRole?: 'explore' | 'builder' | 'reviewer';
  /** Team identifier for Coordinator ↔ Worker routing */
  teamId?: string;
  /** Enable extended thinking mode (default: false) */
  thinkingMode?: boolean;
  /** Extended thinking budget in tokens (default: 1024) */
  thinkingBudget?: number;
  /** External SessionManager — when provided, the engine shares the same
   *  instance as the gateway (session.create/list/resume RPCs). Without
   *  this, each engine creates its own instance, leading to session state
   *  divergence between the TUI and the Agent Loop. */
  sessionManager?: import('@kode/core').SessionManager;
}

export interface EngineFactoryResult {
  /** The configured QueryEngine, ready to submit messages */
  engine: QueryEngine;
  /** Interrupt the in-progress turn (calls AbortController.abort()) */
  interrupt: () => void;
  /** The session ID for this engine */
  sessionId: string;
  /** Resolved agent role: 'coordinator' | 'worker' | 'default' */
  agentRole: string;
  /** Comma-separated tool names registered for this engine */
  toolNames: string;
  /** Human-readable role label */
  roleLabel: string;
}

// ---------------------------------------------------------------------------
// Default tool set
// ---------------------------------------------------------------------------

const ALL_TOOLS: BaseTool[] = [
  new BashTool(),
  new ReadTool(),
  new WriteTool(),
  new EditTool(),
  new GlobTool(),
  new GrepTool(),
  new GitTool(),
  new TodoWriteTool(),
  new TaskCreateTool(),
  new TaskUpdateTool(),
  new TaskListTool(),
  new TaskDescribeTool(),
  new TaskOutputTool(),
  new WebFetchTool(),
  new WebSearchTool(),
  new AskUserQuestionTool(),
  new ExitPlanModeTool(),
  new NotebookEditTool(),
  new LSPTool(),
  new AgentSpawnTool(),
  new AgentReadTool(),
  new AgentMessageTool(),
  new AgentStopTool(),
  new SkillTool(),
  new TeamCreateTool(),
  new TeamDeleteTool(),
  new CronCreateTool(),
  new CronDeleteTool(),
  new CronListTool(),
  new EnterWorktreeTool(),
  new ExitWorktreeTool(),
];

// ---------------------------------------------------------------------------
// Tool role filter — restricts tools by agent role
// ---------------------------------------------------------------------------

/**
 * Tool names allowed per role.
 *
 * Coordinator: full tool set (unrestricted) — plans, delegates, reads, searches.
 * Explore: read-only discovery tools (no writes, no bash, no mutations).
 * Builder: read + write + bash (the core developer toolset).
 * Reviewer: read-only inspection + bash (for running tests/linters).
 */
const TOOL_NAMES_BY_ROLE: Record<string, string[]> = {
  coordinator: [], // empty = unrestricted (all tools)
  explore: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TaskList'],
  builder: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash', 'TaskList', 'TaskOutput', 'NotebookEdit', 'LSP'],
  reviewer: ['Read', 'Glob', 'Grep', 'Bash', 'LSP'],
};

/**
 * Returns the tool names allowed for the given role.
 *
 * @param role — 'coordinator' | 'explore' | 'builder' | 'reviewer' | undefined
 * @returns string[] of tool names, or empty array if unrestricted
 */
export function getToolsForRole(role?: string): string[] {
  if (!role) return [];
  const names = TOOL_NAMES_BY_ROLE[role];
  return names ?? [];
}

/**
 * Filter ALL_TOOLS to only those allowed for the given role.
 * An empty allowlist means all tools are permitted.
 */
function filterToolsByRole(role?: string): BaseTool[] {
  const allowed = getToolsForRole(role);
  if (allowed.length === 0) return ALL_TOOLS;
  return ALL_TOOLS.filter((tool) => allowed.includes(tool.definition.name));
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create a fully configured QueryEngine with all dependencies wired up.
 *
 * Reads ANTHROPIC_API_KEY from the environment (or options.apiKey).
 * Creates an AnthropicProvider, ToolRegistry with all 31 core tools,
 * SessionManager, CheckpointManager, and SystemPromptAssembler.
 *
 * @param cwdOrOptions — Working directory or full options object
 * @returns EngineFactoryResult with engine, interrupt, and sessionId
 */
export function createQueryEngine(
  cwdOrOptions?: string | EngineFactoryOptions,
): EngineFactoryResult {
  const opts: EngineFactoryOptions =
    typeof cwdOrOptions === 'string'
      ? { cwd: cwdOrOptions }
      : (cwdOrOptions ?? {});

  const cwd = opts.cwd ?? process.cwd();
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
  const baseUrl = opts.baseUrl ?? process.env.ANTHROPIC_BASE_URL;
  const model = (opts.model && opts.model !== 'claude-sonnet-4-6') ? opts.model : process.env.KODE_MODEL ?? process.env.ANTHROPIC_MODEL ?? opts.model ?? 'claude-sonnet-4-6';
  const providerName = opts.providerName ?? (model.toLowerCase().includes('deepseek') ? 'deepseek' : process.env.KODE_PROVIDER ?? 'anthropic');

  // ── Determine agent role ─────────────────────────────────────────
  const coordinatorMode = opts.coordinatorMode ?? false;
  const workerRole = opts.workerRole;
  const agentRole: string = coordinatorMode
    ? 'coordinator'
    : workerRole
      ? 'worker'
      : 'default';
  const engineMode: 'default' | 'coordinator' | 'worker' =
    coordinatorMode ? 'coordinator' : workerRole ? 'worker' : 'default';

  // ── 1. Provider — select by providerName ────────────────────────────
  const providerConfig: ProviderConfig = {
    apiKey,
    baseUrl: baseUrl || undefined,
    timeout: 300_000, // 5 minutes
    maxRetries: 3,
  };

  const provider: Provider | undefined = apiKey
    ? createProvider(providerName, providerConfig)
    : undefined;

  // ── 2. ToolRegistry — filter by role ───────────────────────────────
  const toolRegistry = new ToolRegistry();
  const tools =
    coordinatorMode
      ? ALL_TOOLS // coordinator: full tool set
      : workerRole
        ? filterToolsByRole(workerRole) // worker: restricted set
        : ALL_TOOLS; // default: full tool set
  toolRegistry.registerAll(tools);
  const toolNames = tools.map((t) => t.definition.name).join(', ');
  const roleLabel = coordinatorMode ? 'coordinator' : workerRole ?? 'default';

  // ── 3. Session Manager ─────────────────────────────────────────────
  // When the gateway passes its singleton SessionManager, use it so that
  // the TUI (session.create/list/resume RPCs) and the Agent Loop (query.ts
  // tool execution + message tracking) share the same sessions Map.
  // Without this, the engine's separate SessionManager creates a duplicate
  // session that the TUI never sees, and tool results are lost.
  const sessionManager = opts.sessionManager ?? new SessionManager();

  // If a sessionId is provided and the session already exists (created by
  // the gateway's session.create RPC), reuse it. Otherwise create a fresh
  // session. When sharing SessionManager, the gateway must have already
  // called session.create before ensureEngine().
  let sessionId = opts.sessionId;
  if (!sessionId || !sessionManager.get(sessionId)) {
    const session = sessionManager.create({
      cwd,
      model,
      provider: providerName,
      title: `Session ${(sessionId ?? '').slice(0, 8) || 'new'}`,
    });
    sessionId = session.id;
  }

  // ── 4. Checkpoint Manager ──────────────────────────────────────────
  const checkpointManager = new CheckpointManager();

  // ── 4b. Cron Scheduler ────────────────────────────────────────────
  // Initialize the singleton CronScheduler if not already running.
  // Cron tools (CronCreate/CronDelete/CronList) depend on
  // globalThis.__kodeCronScheduler which is set by setCronScheduler().
  if (!getCronScheduler()) {
    const cronScheduler = new CronScheduler({
      autoStart: true,
    });
    setCronScheduler(cronScheduler);
  }

  // ── 5. Build ThinkingConfig ──────────────────────────────────────────
  const thinkingConfig = opts.thinkingMode
    ? {
        mode: 'enabled' as const,
        budgetTokens: opts.thinkingBudget ?? 1024,
      }
    : undefined;

  // ── 5.5 HookManager (lifecycle hooks) ─────────────────────────────
  const hookManager = new HookManager();

  // ── 6. Build QueryEngine ────────────────────────────────────────────
  const engine = new QueryEngine({
    cwd,
    toolRegistry,
    sessionManager,
    maxTurns: opts.maxTurns ?? 100,
    maxBudgetUsd: opts.maxBudgetUsd,
    contextBudget: opts.contextBudget ?? 180_000,
    compactThreshold: opts.compactThreshold ?? 0.7,
    customSystemPrompt: opts.customSystemPrompt,
    appendSystemPrompt: opts.appendSystemPrompt ?? process.env.KODE_APPEND_SYSTEM_PROMPT,
    model,
    // Provider is wired via provider + providerModel for lazy adapter loading
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provider: provider as any,
    providerModel: model,
    subagentBus: opts.subagentBus,
    mode: engineMode,
    thinkingConfig,
    hookManager,
  });

  // ── 7. Interrupt function ──────────────────────────────────────────
  const interrupt = (): void => {
    engine.interrupt();
    if (provider) {
      provider.abort();
    }
  };

  return { engine, interrupt, sessionId, agentRole, toolNames, roleLabel };
}

// ---------------------------------------------------------------------------
// Provider Factory
// ---------------------------------------------------------------------------

/**
 * Create a Provider instance based on the provider name.
 *
 * @param name — "anthropic" | "openai" | "deepseek" | "auto"
 * @param config — Provider configuration (apiKey, baseUrl, etc.)
 * @returns A Provider instance
 */
function createProvider(name: string, config: ProviderConfig): Provider {
  const isAnthropicEndpoint = config.baseUrl?.includes('/anthropic');

  switch (name) {
    case 'openai':
      return new OpenAICompatProvider(config, 'openai');
    case 'deepseek': {
      // DeepSeek's /anthropic endpoint uses Anthropic Messages API format, not
      // OpenAI Chat Completions.  When the base URL targets the /anthropic
      // endpoint we must use AnthropicProvider so the SDK sends the correct
      // request shape.
      if (isAnthropicEndpoint) {
        return new AnthropicProvider(config);
      }
      return new DeepSeekProvider(config);
    }
    case 'auto': {
      // Auto mode: create a router with all providers that have API keys configured
      const router = new ProviderRouter();
      // Register Anthropic (always available)
      router.register('anthropic', new AnthropicProvider(config), ['*']);
      // Register OpenAI if key available
      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) {
        router.register('openai', new OpenAICompatProvider({ ...config, apiKey: openaiKey }, 'openai'), ['gpt-4o', 'gpt-4o-mini']);
      }
      // Register DeepSeek if key available — use the right provider per endpoint
      const deepseekKey = process.env.DEEPSEEK_API_KEY;
      if (deepseekKey) {
        const deepseekCfg = { ...config, apiKey: deepseekKey };
        const deepseekProvider = isAnthropicEndpoint
          ? new AnthropicProvider(deepseekCfg)
          : new DeepSeekProvider(deepseekCfg);
        router.register('deepseek', deepseekProvider, ['deepseek-chat', 'deepseek-reasoner']);
      }
      // Return a proxy provider that delegates to the router
      return createRouterProxy(router, config.apiKey ? 'anthropic' : undefined);
    }
    case 'anthropic':
    default:
      return new AnthropicProvider(config);
  }
}

/**
 * Create a proxy Provider that delegates to a ProviderRouter.
 * The first message call uses classifyAndRoute to select the best provider.
 */
function createRouterProxy(router: ProviderRouter, _defaultProvider?: string): Provider {
  const routerRef = { current: router };
  const providerRef: { current: Provider | null } = { current: null };
  const modelRef: { current: string } = { current: 'claude-sonnet-4-6' };

  return {
    async stream(modelConfig, system, messages, tools, onEvent) {
      if (!providerRef.current) {
        // Determine task from the last user message and auto-route
        const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
        const task = typeof lastUserMsg?.content === 'string'
          ? lastUserMsg.content
          : 'general task';
        const route = routerRef.current.classifyAndRoute(task);
        providerRef.current = route.provider;
        modelRef.current = route.model;
      }
      return providerRef.current.stream(
        { ...modelConfig, model: modelRef.current },
        system, messages, tools, onEvent,
      );
    },
    abort() {
      providerRef.current?.abort();
    },
    async listModels() {
      return routerRef.current.listAllModels();
    },
  };
}

// ---------------------------------------------------------------------------
// Convenience: resolve API Key
// ---------------------------------------------------------------------------

/**
 * Check whether any API key is configured (env or options).
 */
export function hasApiKey(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_AUTH_TOKEN ||
    process.env.OPENAI_API_KEY ||
    process.env.DEEPSEEK_API_KEY,
  );
}

/**
 * Get the configured model name.
 */
export function getConfiguredModel(): string {
  return process.env.KODE_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
}
