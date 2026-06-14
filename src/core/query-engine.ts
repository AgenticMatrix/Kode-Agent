/**
 * QueryEngine — Session lifecycle manager
 *
 * Consumes the query() AsyncGenerator, manages session state,
 * and provides the main entry point for user interaction.
 *
 * Adapted from CoderAgent for ink-chat-tui.
 */

import type {
  Session,
  AssistantMessage,
  UserMessage,
  QueryMessage,
  StreamEvent,
  DeferredPermission,
  ContentBlock,
} from './types.js';
import { PermissionMode, AgentError } from './types.js';
import { query, type QueryConfig, type CallModelParams } from './query.js';
import { ToolRegistry } from './tool-registry.js';
import { PermissionEngine } from './permission.js';
import { SystemPromptAssembler, type SystemPrompt } from './system-prompt.js';
import { SessionManager } from './session.js';
import { CheckpointManager } from './checkpoint.js';
import type { HookManager } from './hooks.js';
import type { SubAgentRegistry } from './subagent-registry.js';
import type { AgentRegistry } from './agent-registry.js';
import { getAgentRole, getCoordinatorSystemContext } from '../teams/coordinator-mode.js';
import { drainUnreadMessages } from '../teams/team-mailbox.js';
import { execute as executeAgentMessage } from '../agents/agent-message/executor.js';
import type { CoderSettings } from '../cli/config.js';
import type { ToolResult } from '../tools/types.js';

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
  /** Max concurrent tool executions (default: 32). */
  maxToolConcurrency?: number;
  callModel: (params: CallModelParams) => AsyncGenerator<StreamEvent | AssistantMessage>;
  /** Optional HookManager for lifecycle hook execution */
  hookManager?: HookManager;
  /** SubAgentRegistry for tracking spawned sub-agents */
  subAgentRegistry?: SubAgentRegistry;
  /** SystemPromptAssembler for assembling worker/coordinator prompts */
  systemPromptAssembler?: SystemPromptAssembler;
  /** AgentRegistry for agent type definitions */
  agentRegistry?: AgentRegistry;
  /** CoderSettings for coordinator mode detection */
  settings?: CoderSettings;
  /** Active team name (when running in coordinator mode) */
  teamName?: string;
}

export interface QueryEngineEvent {
  type: 'message' | 'error' | 'cost' | 'compact' | 'done' | 'permission_required';
  data?: unknown;
  deferred?: DeferredPermission;
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
    const assembler = this.config.systemPromptAssembler ?? new SystemPromptAssembler();
    const agentRole = getAgentRole(this.config.settings);

    // If coordinator with team active, inject team context into append prompt
    let appendPrompt = this.config.appendSystemPrompt;
    if (agentRole === 'coordinator' && this.config.teamName) {
      const teamCtx = await getCoordinatorSystemContext(this.config.teamName);
      if (teamCtx) {
        appendPrompt = appendPrompt ? `${appendPrompt}\n\n${teamCtx}` : teamCtx;
      }
    }

    this.systemPrompt = await assembler.assemble({
      cwd: this.config.cwd,
      permissionMode: this.permissionEngine.getMode(),
      customPrompt: this.config.customSystemPrompt,
      appendPrompt,
      agentRole,
      model: this.config.model,
    });

    // Setup hook (non-blockable, fires on first init)
    if (this.config.hookManager) {
      const session = this.config.sessionManager.getActive();
      if (session && session.messages.length === 0) {
        this.config.hookManager.onSetup(
          session.id,
          this.config.cwd,
          true,
          this.config.model,
          undefined,
        ).catch(() => {});
      }
    }
  }

  async *submitMessage(userInput: string): AsyncGenerator<QueryEngineEvent> {
    // Abort any in-progress query
    if (this.abortController) {
      this.abortController.abort();
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    const session = this.config.sessionManager.getActive();
    this.abortController = new AbortController();

    // Handle orphaned tool_use blocks from prior interrupted turn
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
        { model: this.config.model, provider: undefined },
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

      // UserPromptExpansion hook (blockable)
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

    // Inject completed background agent results as system context
    if (this.config.subAgentRegistry) {
      const notifications = this.config.subAgentRegistry.drainNotifications();
      if (notifications.length > 0) {
        const contextBlock: ContentBlock = {
          type: 'text',
          text: '[Background agent results]\n' + notifications.join('\n\n'),
        };
        this.config.sessionManager.addMessage({
          role: 'user',
          content: [contextBlock],
        });
      }
    }

    // Drain team messages for coordinator (inject unread messages as context)
    if (this.config.teamName && this.config.settings) {
      const coordinatorName = 'coordinator';
      const teamMsgs = await drainUnreadMessages(this.config.teamName, coordinatorName);
      if (teamMsgs.length > 0) {
        const msgsText = teamMsgs.map(m =>
          `[${m.from} → ${m.to}]: ${m.text}`
        ).join('\n');
        const contextBlock: ContentBlock = {
          type: 'text',
          text: '[Team messages]\n' + msgsText,
        };
        this.config.sessionManager.addMessage({
          role: 'user',
          content: [contextBlock],
        });
      }
    }

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
      maxToolConcurrency: this.config.maxToolConcurrency,
      callModel: this.config.callModel,
      hookManager: this.config.hookManager,
      subAgentRegistry: this.config.subAgentRegistry,
      systemPromptAssembler: this.config.systemPromptAssembler,
      agentRegistry: this.config.agentRegistry,
      agentRole: getAgentRole(this.config.settings),
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
              yield { type: 'message', data: msg };
            } else if (msg.subtype === 'permission_required') {
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

  /** Send a follow-up message to a completed/stopped sub-agent, resuming its execution. */
  async sendSubAgentMessage(agentId: string, message: string): Promise<ToolResult> {
    const { subAgentRegistry, toolRegistry, sessionManager, callModel, hookManager, systemPromptAssembler, agentRegistry } = this.config;
    if (!subAgentRegistry || !systemPromptAssembler || !agentRegistry) {
      return { content: 'Sub-agent infrastructure not available.', isError: true };
    }

    return executeAgentMessage(
      { agent_id: agentId, message },
      {
        sessionId: sessionManager.getActive().id,
        cwd: this.config.cwd,
        allowMutation: true,
        maxOutput: 200_000,
        bashTimeout: 120_000,
        agentSpawn: {
          callModel,
          toolRegistry,
          sessionManager,
          subAgentRegistry,
          hookManager,
          systemPromptAssembler,
          agentRegistry,
        },
      },
    );
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

  setPermissionMode(mode: PermissionMode): void {
    this.permissionEngine.setMode(mode);

    // ConfigChange hook (non-blockable)
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
