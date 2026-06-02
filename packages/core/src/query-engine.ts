/**
 * QueryEngine — Session lifecycle manager
 *
 * Consumes the query() AsyncGenerator, manages session state,
 * and provides the main entry point for user interaction.
 *
 * Agent QueryEngine — main entry point for agent queries.
 * Architecture reference: ARCHITECTURE.md §4.1
 */

import type {
  Session,
  AssistantMessage,
  UserMessage,
  QueryMessage,
  StreamEvent,
  DeferredPermission,
  ContentBlock,
} from '@coder/shared';
import { PermissionMode, AgentError } from '@coder/shared';
import { query, type QueryConfig, type CallModelParams } from './query.js';
import { ToolRegistry } from './tool-registry.js';
import { PermissionEngine } from './permission/engine.js';
import { SystemPromptAssembler, type SystemPrompt } from './system-prompt/assembler.js';
import { SessionManager } from './session.js';
import { CheckpointManager } from './checkpoint.js';
import type { Provider, ThinkingConfig } from '@coder/provider';
import { createCallModelFromProvider } from './provider-adapter.js';
import type { SubagentBus } from '@coder/shared';
import type { HookManager } from './hooks/manager.js';

// ---------------------------------------------------------------------------
// SystemPrompt cache — avoids re-assembling identical prompts across engine
// instances. Keyed by cwd + permission mode + agent role. 30-second TTL.
// ---------------------------------------------------------------------------

interface CachedPrompt {
  prompt: SystemPrompt;
  timestamp: number;
}

const systemPromptCache = new Map<string, CachedPrompt>();
const PROMPT_CACHE_TTL_MS = 30_000;
const PROMPT_CACHE_MAX_SIZE = 50;

function purgeStalePromptCache(): void {
  if (systemPromptCache.size <= PROMPT_CACHE_MAX_SIZE) return;
  const now = Date.now();
  for (const [key, entry] of systemPromptCache) {
    if (now - entry.timestamp > PROMPT_CACHE_TTL_MS) {
      systemPromptCache.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueryEngineConfig {
  cwd: string;
  toolRegistry: ToolRegistry;
  sessionManager: SessionManager;
  maxTurns?: number;
  maxBudgetUsd?: number;
  contextBudget?: number;
  compactThreshold?: number;
  customSystemPrompt?: string;
  appendSystemPrompt?: string;
  model?: string;
  callModel?: (params: CallModelParams) => AsyncGenerator<StreamEvent | AssistantMessage>;
  /** Convenience: pass a Provider to auto-bridge via provider-adapter */
  provider?: Provider;
  /** Model name used when provider is set */
  providerModel?: string;
  /** Optional SubagentBus for tracking background sub-agents */
  subagentBus?: SubagentBus;
  /** Worker agentId — when set, drains messageQueue each turn via subagentBus */
  agentId?: string;
  /** Engine mode: 'default' | 'coordinator' | 'worker' (default: 'default') */
  mode?: 'default' | 'coordinator' | 'worker';
  /** Extended thinking configuration (passed to Provider via ModelConfig.thinking) */
  thinkingConfig?: ThinkingConfig;
  /** Optional HookManager for lifecycle hook execution (UserPromptSubmit, etc.) */
  hookManager?: HookManager;
}

export interface QueryEngineEvent {
  type: 'message' | 'error' | 'cost' | 'compact' | 'done' | 'permission_required';
  data?: unknown;
  deferred?: DeferredPermission;
}

// ---------------------------------------------------------------------------
// Mock Provider
// ---------------------------------------------------------------------------

async function* mockCallModel(_params: CallModelParams): AsyncGenerator<StreamEvent | AssistantMessage> {
  yield { type: 'message_start', message: { model: 'mock', usage: { input_tokens: 0, output_tokens: 0 } } };
  yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
  const text = `I'll help you with that. Let me determine what tools to use for this task.`;
  yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } };
  yield { type: 'content_block_stop', index: 0 };
  yield { type: 'message_delta', delta: { stop_reason: 'end_turn', usage: { input_tokens: 500, output_tokens: 50 } } };
  // Yield a final AssistantMessage so the TUI bridge can emit message.complete
  // and transition busy → false. Without this, the FaceTicker spins forever.
  yield {
    role: 'assistant',
    content: [{ type: 'text', text }],
    stopReason: 'end_turn',
    usage: { input_tokens: 500, output_tokens: 50 },
    model: 'mock',
    toolUseBlocks: [],
  };
}

// ---------------------------------------------------------------------------
// QueryEngine
// ---------------------------------------------------------------------------

export class QueryEngine {
  private config: QueryEngineConfig;
  private permissionEngine: PermissionEngine;
  private abortController: AbortController | null = null;
  private checkpointManager: CheckpointManager;
  private systemPrompt: SystemPrompt | null = null;

  constructor(config: QueryEngineConfig) {
    this.config = {
      maxTurns: 100,
      contextBudget: 180_000,
      compactThreshold: 0.7,
      model: 'deepseek-v4-pro',
      ...config,
    };
    this.permissionEngine = new PermissionEngine(config.cwd);
    this.checkpointManager = new CheckpointManager();
  }

  async init(): Promise<void> {
    const mode = this.config.mode ?? 'default';
    const cacheKey = `${this.config.cwd}:${this.permissionEngine.getMode()}:${mode}`;

    // Serve from cache if valid — saves ~50-200ms of assembly time.
    const cached = systemPromptCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < PROMPT_CACHE_TTL_MS) {
      this.systemPrompt = cached.prompt;
      return;
    }

    const assembler = new SystemPromptAssembler();
    this.systemPrompt = await assembler.assemble({
      cwd: this.config.cwd,
      permissionMode: this.permissionEngine.getMode(),
      customPrompt: this.config.customSystemPrompt,
      appendPrompt: this.config.appendSystemPrompt,
      agentRole: mode === 'coordinator' ? 'coordinator' : mode === 'worker' ? 'worker' : 'default',
    });

    systemPromptCache.set(cacheKey, { prompt: this.systemPrompt, timestamp: Date.now() });
    purgeStalePromptCache();

    // ── Setup hook (non-blockable, fires on first init) ─────────────
    if (this.config.hookManager) {
      const session = this.config.sessionManager.getActive();
      if (session && session.messages.length === 0) {
        this.config.hookManager.onSetup(
          session.id,
          this.config.cwd,
          true,
          this.config.model,
          this.config.providerModel,
        ).catch(() => {});
      }
    }
  }

  async *submitMessage(userInput: string): AsyncGenerator<QueryEngineEvent> {
    // 1) Abort any in-progress query so we don't leave it un-abortable.
    //    After abort, yield to the event loop so the previous query() can:
    //      a) resolve pending DeferredPermissions (via microtask)
    //      b) emit error tool_results for the aborted tools
    //      c) have its for-await loop persist those results to the session
    //    This prevents orphan cleanup from injecting duplicate tool_results
    //    that would cause API 400 errors on subsequent requests.
    if (this.abortController) {
      this.abortController.abort();
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    const session = this.config.sessionManager.getActive();
    this.abortController = new AbortController();

    // 2) Scan for orphaned tool_use blocks from any prior interrupted turn
    const lastMsg = session.messages.length > 0
      ? session.messages[session.messages.length - 1]
      : null;
    const MISSING_RESULT_PROMPT =
      'A new user message arrived while tools were executing. ' +
      'The pending tool use results are unavailable.';

    if (lastMsg && lastMsg.role === 'assistant' && Array.isArray(lastMsg.content)) {
      const toolUseBlocks = lastMsg.content.filter((b) => b.type === 'tool_use');
      if (toolUseBlocks.length > 0) {
        const errorResults: ContentBlock[] = toolUseBlocks.map((b) => ({
          type: 'tool_result' as const,
          tool_use_id: b.id!,
          content: MISSING_RESULT_PROMPT,
          is_error: true,
        }));
        this.config.sessionManager.addMessage({
          role: 'user',
          content: errorResults,
        });
      }
    }

    // === UserPromptSubmit hook (blockable) ===
    let effectiveInput = userInput;
    if (this.config.hookManager) {
      const result = await this.config.hookManager.onUserPromptSubmit(
        session.id,
        this.config.cwd,
        userInput,
        { model: this.config.model, provider: this.config.providerModel },
      );
      if (result.blocked) {
        yield {
          type: 'error',
          data: new AgentError(
            result.blockReason ?? 'Prompt blocked by UserPromptSubmit hook',
            'HOOK_BLOCKED',
          ),
        };
        return;
      }
      if (result.augmentedPrompt) {
        effectiveInput = result.augmentedPrompt;
      }

      // ── UserPromptExpansion hook (blockable) ──────────────────────
      const expansionResult = await this.config.hookManager.onUserPromptExpansion(
        session.id,
        this.config.cwd,
        userInput,
        effectiveInput,
      );
      if (expansionResult.blocked) {
        yield {
          type: 'error',
          data: new AgentError(
            expansionResult.blockReason ?? 'Prompt blocked by UserPromptExpansion hook',
            'HOOK_BLOCKED',
          ),
        };
        return;
      }
      if (expansionResult.expandedPromptOverride) {
        effectiveInput = expansionResult.expandedPromptOverride;
      }
    }

    const userMessage: UserMessage = { role: 'user', content: effectiveInput };
    this.config.sessionManager.addMessage(userMessage);

    if (!this.systemPrompt) {
      await this.init();
    }

    const queryConfig: QueryConfig = {
      sessionId: session.id,
      cwd: this.config.cwd,
      messages: [...session.messages],
      systemPrompt: this.systemPrompt!,
      toolRegistry: this.config.toolRegistry,
      permissionEngine: this.permissionEngine,
      sessionManager: this.config.sessionManager,
      checkpointManager: this.checkpointManager,
      abortController: this.abortController,
      maxTurns: this.config.maxTurns!,
      maxBudgetUsd: this.config.maxBudgetUsd,
      contextBudget: this.config.contextBudget!,
      compactThreshold: this.config.compactThreshold!,
      callModel: this.resolveCallModel(),
      subagentBus: this.config.subagentBus,
      agentId: this.config.agentId,
      hookManager: this.config.hookManager,
      // Dynamic system prompt refresh — re-assembles each turn so that
      // MEMORY, Skills, and Hooks context can evolve during conversation.
      // Always creates a fresh assembler to bypass the init() cache.
      refreshSystemPrompt: async () => {
        const assembler = new SystemPromptAssembler();
        return assembler.assemble({
          cwd: this.config.cwd,
          permissionMode: this.permissionEngine.getMode(),
          customPrompt: this.config.customSystemPrompt,
          appendPrompt: this.config.appendSystemPrompt,
          agentRole: this.config.mode === 'coordinator'
            ? 'coordinator'
            : this.config.mode === 'worker'
              ? 'worker'
              : 'default',
        });
      },
    };

    try {
      for await (const msg of query(queryConfig)) {
        switch (msg.type) {
          case 'stream_event':
            yield { type: 'message', data: msg };
            break;
          case 'assistant':
            this.config.sessionManager.addMessage(msg.message);
            yield { type: 'message', data: msg };
            break;
          case 'user':
            this.config.sessionManager.addMessage(msg.message);
            yield { type: 'message', data: msg };
            break;
          case 'system':
            if (msg.subtype === 'compact_boundary') {
              yield { type: 'compact', data: msg.compactMetadata };
            } else if (msg.subtype === 'error') {
              yield { type: 'error', data: msg.error };
            } else if (msg.subtype === 'progress') {
              // Forward tool progress events (started/running/completed)
              // so the TUI can emit tool.start / tool.complete events.
              yield { type: 'message', data: msg };
            } else if (msg.subtype === 'permission_required') {
              // Pass through to the caller (e.g. TUI Gateway) so it can
              // display an approval overlay and resolve via deferred.resolve()
              yield { type: 'permission_required', data: msg.deferred, deferred: msg.deferred };
            }
            break;
        }
      }
      yield { type: 'done', data: { sessionId: session.id } };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      yield { type: 'error', data: { message: errMsg } };
      throw error;
    } finally {
      this.config.sessionManager.saveSession(session);
    }
  }

  interrupt(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  async resume(sessionId: string): Promise<Session> {
    const session = this.config.sessionManager.resume(sessionId);
    this.permissionEngine.setCwd(session.cwd);
    this.checkpointManager.loadFromDisk(sessionId);
    return session;
  }

  fork(fromTurn?: number): Session {
    const session = this.config.sessionManager.getActive();
    return this.config.sessionManager.fork({ sessionId: session.id, fromTurn, cwd: this.config.cwd });
  }

  rewind(toTurn: number): Session {
    const session = this.config.sessionManager.getActive();
    return this.config.sessionManager.rewind(session.id, toTurn);
  }

  getPermissionEngine(): PermissionEngine {
    return this.permissionEngine;
  }

  getSessionManager(): SessionManager {
    return this.config.sessionManager;
  }

  /**
   * Resolve the callModel function from config.
   *
   * Priority:
   * 1. Explicit callModel function passed in
   * 2. Provider + providerModel → lazy-import the adapter
   * 3. Built-in mock (always available, no API key needed)
   */
  private resolveCallModel(): (params: CallModelParams) => AsyncGenerator<StreamEvent | AssistantMessage> {
    if (this.config.callModel) return this.config.callModel;
    if (this.config.provider && this.config.providerModel) {
      return createCallModelFromProvider(
        this.config.provider,
        this.config.providerModel,
        this.config.thinkingConfig,
      );
    }
    return mockCallModel;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.permissionEngine.setMode(mode);

    // ── ConfigChange hook (non-blockable) ───────────────────────────
    if (this.config.hookManager) {
      try {
        const session = this.config.sessionManager.getActive();
        if (session) {
          this.config.hookManager.onConfigChange(
            session.id,
            this.config.cwd,
            ['permissionMode'],
            { permissionMode: mode },
            undefined,
          ).catch(() => {});
        }
      } catch {
        // Non-blockable: session may not be active yet
      }
    }
  }

  shutdown(): void {
    this.interrupt();
    const session = this.config.sessionManager.getActive();
    this.config.sessionManager.saveSession(session);
  }
}
