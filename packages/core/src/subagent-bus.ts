/**
 * subagent-bus.ts — Core-side SubagentBus engine-runner integration
 *
 * Provides createRunAgentCallback() — a factory that returns a
 * RunAgentCallback wired to the Kode Agent runtime (QueryEngine,
 * SessionManager, ToolRegistry).
 *
 * The shared @kode/shared SubagentBus is a pure coordinator. Engine
 * creation happens here in @kode/core where QueryEngine lives.
 *
 * Usage (in CLI layer):
 *   import { getSubagentBus } from '@kode/shared';
 *   import { createRunAgentCallback } from '@kode/core';
 *
 *   const bus = getSubagentBus();
 *   bus.initialize({
 *     runAgent: createRunAgentCallback({ cwd, toolRegistry, callModel, model }),
 *   });
 *
 * Architecture reference: ARCHITECTURE.md §4.3 (Sub-Agent System)
 */

import type { Message, StreamEvent, AssistantMessage } from '@kode/shared';
import type {
  SubagentEntry,
  SubagentSpawnConfig,
  RunAgentCallback,
  ForkSessionConfig,
  RunForkAgentCallback,
  WorkerConfig,
} from '@kode/shared';
import { QueryEngine } from './query-engine.js';
import { ToolRegistry } from './tool-registry.js';
import { SessionManager } from './session.js';
import type { HookManager } from './hooks/manager.js';
import type { CallModelParams } from './query.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateRunAgentOptions {
  cwd: string;
  /** The FULL parent tool registry — callback creates a restricted copy */
  toolRegistry: ToolRegistry;
  /** callModel function shared with the parent engine */
  callModel: (params: CallModelParams) => AsyncGenerator<StreamEvent | AssistantMessage>;
  model?: string;
  systemPrompt?: string;
  defaultMaxTurns?: number;
  /**
   * Optional HookManager for lifecycle hook execution.
   * When provided, SubagentStart and SubagentStop hooks are fired
   * around sub-agent execution.
   */
  hookManager?: HookManager;
  /**
   * Optional WorkerConfig for role-based tool restrictions.
   * When provided, allowedTools from the config override the default
   * RESTRICTED_TOOL_NAMES exclusion list.
   *
   * - If `allowedTools` contains `"*"` (Coordinator wildcard), all tools
   *   except the agent-recursion tools (Agent/AgentMessage/AgentStop/AgentRead)
   *   are allowed.
   * - If `allowedTools` is a specific list, only those tools are registered.
   * - If `workerConfig` is not provided, the original hardcoded restriction
   *   (exclude Agent/AgentMessage/AgentStop/AgentRead) is used as default.
   */
  workerConfig?: WorkerConfig;
}

export interface CreateForkAgentOptions {
  cwd: string;
  /** The FULL parent tool registry — forked agent inherits unrestricted access */
  toolRegistry: ToolRegistry;
  /** callModel function shared with the parent engine */
  callModel: (params: CallModelParams) => AsyncGenerator<StreamEvent | AssistantMessage>;
  /** Parent session manager — forked agents inherit its messages */
  sessionManager: SessionManager;
  model?: string;
  systemPrompt?: string;
  defaultMaxTurns?: number;
  /** Token budget for the forked session (default: 200000) */
  contextBudget?: number;
  /**
   * Optional HookManager for lifecycle hook execution.
   * When provided, SubagentStart and SubagentStop hooks are fired
   * around forked agent execution.
   */
  hookManager?: HookManager;
}

// ---------------------------------------------------------------------------
// Tool restrictions
// ---------------------------------------------------------------------------

/**
 * Tool names forbidden in sub-agent contexts.
 * Prevents infinite agent-spawning recursion and cross-agent confusion.
 */
const RESTRICTED_TOOL_NAMES = new Set(['Agent', 'AgentMessage', 'AgentStop', 'AgentRead']);

// ---------------------------------------------------------------------------
// createRunAgentCallback
// ---------------------------------------------------------------------------

/**
 * Create a RunAgentCallback that spawns restricted QueryEngines.
 *
 * Each sub-agent gets:
 *  - An isolated SessionManager (forked from parent session lineage)
 *  - A restricted ToolRegistry (no Agent tools → no infinite recursion)
 *  - Its own QueryEngine with a configurable maxTurns limit
 *
 * The callback is passed to SubagentBus.initialize() and invoked
 * by SubagentBus.spawn() for each new sub-agent.
 */
export function createRunAgentCallback(options: CreateRunAgentOptions): RunAgentCallback {
  const { cwd, toolRegistry, callModel, model, systemPrompt, defaultMaxTurns = 50, workerConfig, hookManager } = options;

  return async function runAgent(
    agentId: string,
    entry: SubagentEntry,
    parentSessionId: string,
    spawnConfig: SubagentSpawnConfig,
  ): Promise<void> {
    entry.status = 'running';
    const startTime = Date.now();

    // ── SubagentStart hook ────────────────────────────────────────
    if (hookManager) {
      const allowedToolNames = workerConfig?.allowedTools ?? ['*'];
      hookManager.onSubagentStart(
        parentSessionId,
        cwd,
        spawnConfig.description.slice(0, 80),
        spawnConfig.prompt.slice(0, 500),
        allowedToolNames,
      ).catch(() => {
        // Hook errors are non-fatal — never crash the agent
      });

      // ── TaskCreated hook (non-blockable) ─────────────────────────
      hookManager.onTaskCreated(
        parentSessionId,
        cwd,
        agentId,
        'subagent',
        spawnConfig.prompt.slice(0, 500),
        allowedToolNames[0] === '*' ? undefined : allowedToolNames,
      ).catch(() => {
        // Non-blockable event: hook failures are silently ignored
      });
    }

    // ── Build restricted tool registry ────────────────────────────
    //
    // Priority (per-spawn overrides global):
    // 1. spawnConfig.workerConfig.allowedTools with "*" → all tools except agent-recursion tools
    // 2. spawnConfig.workerConfig.allowedTools (explicit list) → only those tools
    // 3. options.workerConfig.allowedTools with "*" → all tools except agent-recursion tools
    // 4. options.workerConfig.allowedTools (explicit list) → only those tools
    // 5. No workerConfig → default: exclude Agent/AgentMessage/AgentStop/AgentRead
    const restrictedRegistry = new ToolRegistry();
    const effectiveWorkerConfig = spawnConfig.workerConfig ?? workerConfig;
    const allowedTools = effectiveWorkerConfig?.allowedTools;
    const hasWildcard = allowedTools && allowedTools.length === 1 && allowedTools[0] === '*';

    for (const toolEntry of toolRegistry.getAll()) {
      const toolName = toolEntry.definition.name;

      if (allowedTools && allowedTools.length > 0) {
        // WorkerConfig provided: use allow-list approach
        if (hasWildcard) {
          // Coordinator wildcard: allow everything except agent recursion tools
          if (!RESTRICTED_TOOL_NAMES.has(toolName)) {
            restrictedRegistry.register(toolEntry.instance);
          }
        } else {
          // Explicit allow-list: only register tools in the list
          if (allowedTools.includes(toolName)) {
            restrictedRegistry.register(toolEntry.instance);
          }
        }
      } else {
        // Default (no workerConfig): exclude agent recursion tools
        if (!RESTRICTED_TOOL_NAMES.has(toolName)) {
          restrictedRegistry.register(toolEntry.instance);
        }
      }
    }

    // Isolated SessionManager for this sub-agent
    const sessionManager = new SessionManager();
    sessionManager.create({
      cwd,
      model,
      parentSessionId,
      title: `subagent: ${spawnConfig.description.slice(0, 50)}`,
    });

    const engine = new QueryEngine({
      cwd,
      toolRegistry: restrictedRegistry,
      sessionManager,
      maxTurns: spawnConfig.maxTurns ?? defaultMaxTurns,
      callModel,
      model,
      customSystemPrompt: systemPrompt,
      agentId, // Worker identity for message queue draining
      mode: 'worker',
    });

    await engine.init();

    try {
      for await (const event of engine.submitMessage(spawnConfig.prompt)) {
        // Collect structured messages
        if (event.type === 'message' && event.data) {
          const data = event.data as { type?: string; message?: Message };

          if (data.type === 'assistant' && data.message) {
            entry.messages.push(data.message);
            entry.turnCount++;
            // Also build a human-readable transcript line
            entry.transcript.push(messageToLine(data.message));
          } else if (data.type === 'user' && data.message) {
            entry.messages.push(data.message);
          }
        }

        if (event.type === 'error') {
          const errData = event.data as { message?: string } | undefined;
          entry.error = errData?.message ?? 'Unknown error';
          engine.shutdown();
          // resolveDone is called via settle() — we reach it through the spawn() catch handler
          throw new Error(entry.error);
        }

        if (event.type === 'done') {
          entry.result = extractResultText(entry.messages as Message[]);
          engine.shutdown();

          // ── SubagentStop hook (success) ──────────────────────────
          if (hookManager) {
            const durationMs = Date.now() - startTime;
            const tokenUsage = entry.messages.length; // approximate
            hookManager.onSubagentStop(
              parentSessionId,
              cwd,
              spawnConfig.description.slice(0, 80),
              true,
              entry.result ?? 'Task completed',
              tokenUsage,
              durationMs,
            ).catch(() => { /* non-fatal */ });

            // ── TaskCompleted hook (non-blockable) ─────────────────
            hookManager.onTaskCompleted(
              parentSessionId,
              cwd,
              agentId,
              'completed',
              entry.result ?? 'Task completed',
              {
                tokens: tokenUsage,
                toolCalls: entry.turnCount,
                durationMs,
              },
            ).catch(() => { /* non-fatal */ });
          }

          return; // donePromise resolves → spawn() settles as 'completed'
        }
      }
    } catch (error: unknown) {
      entry.error = error instanceof Error ? error.message : String(error);

      // ── SubagentStop hook (failure) ─────────────────────────────
      if (hookManager) {
        const durationMs = Date.now() - startTime;
        hookManager.onSubagentStop(
          parentSessionId,
          cwd,
          spawnConfig.description.slice(0, 80),
          false,
          entry.error ?? 'Unknown error',
          0,
          durationMs,
        ).catch(() => { /* non-fatal */ });

        // ── TaskCompleted hook (non-blockable, failed) ────────────
        hookManager.onTaskCompleted(
          parentSessionId,
          cwd,
          agentId,
          'failed',
          entry.error ?? 'Unknown error',
          {
            tokens: 0,
            toolCalls: entry.turnCount,
            durationMs,
          },
        ).catch(() => { /* non-fatal */ });
      }

      throw error; // re-throw to let spawn()'s .catch() handle settlement
    }
  };
}

// ---------------------------------------------------------------------------
// createForkAgentCallback
// ---------------------------------------------------------------------------

/**
 * Create a RunForkAgentCallback that spawns QueryEngines inheriting
 * the parent's full message context.
 *
 * Each forked agent gets:
 *  - The FULL parent message history (deep-copied at fork time)
 *  - The parent's unrestricted ToolRegistry (no tool exclusions)
 *  - An isolated SessionManager seeded with parent messages
 *  - Its own QueryEngine with a configurable maxTurns limit
 *  - A larger context window (200K token budget by default)
 *
 * The callback is passed to SubagentBus.initialize() and invoked
 * by SubagentBus.forkSession() for each new forked agent.
 */
export function createForkAgentCallback(options: CreateForkAgentOptions): RunForkAgentCallback {
  const {
    cwd,
    toolRegistry,
    callModel,
    sessionManager,
    model,
    systemPrompt,
    defaultMaxTurns = 50,
    contextBudget = 200000,
    hookManager,
  } = options;

  return async function runForkAgent(
    agentId: string,
    entry: SubagentEntry,
    parentSessionId: string,
    config: ForkSessionConfig,
  ): Promise<void> {
    entry.status = 'running';
    const startTime = Date.now();

    // ── SubagentStart hook ────────────────────────────────────────
    if (hookManager) {
      hookManager.onSubagentStart(
        parentSessionId,
        cwd,
        config.description.slice(0, 80),
        config.prompt.slice(0, 500),
        ['*'], // Fork inherits full tool access — no restrictions
      ).catch(() => {
        // Hook errors are non-fatal — never crash the agent
      });

      // ── TaskCreated hook (non-blockable) ─────────────────────────
      hookManager.onTaskCreated(
        parentSessionId,
        cwd,
        agentId,
        'subagent',
        config.prompt.slice(0, 500),
        undefined, // Unrestricted tool set for fork
      ).catch(() => {
        // Non-blockable event: hook failures are silently ignored
      });
    }

    // ── Snapshot parent messages at fork time ──────────────────────
    //
    // We deep-copy the active session's messages at invocation time.
    // At this point the parent's tool execution is still in progress
    // (the Agent tool hasn't returned yet), so messages[] contains
    // the full context up to and including the assistant message
    // that called the Agent tool.
    let parentMessages: Message[] = [];
    try {
      const activeSession = sessionManager.getActive();
      parentMessages = structuredClone(activeSession.messages);
    } catch {
      // If sessionManager is unavailable, fall back to empty context
      // The fork will run with only the prompt as context
    }

    // ── Create isolated forked session ─────────────────────────────
    const forkedSessionManager = new SessionManager();
    const forkedSession = forkedSessionManager.create({
      cwd,
      model,
      parentSessionId,
      title: `fork: ${config.description.slice(0, 50)}`,
    });

    // Seed the forked session with parent message history
    for (const msg of parentMessages) {
      forkedSessionManager.addMessage(msg);
    }

    // ── Create unrestricted engine ─────────────────────────────────
    //
    // Fork inherits the FULL parent tool registry with NO restrictions.
    // Unlike spawn(), we do NOT filter out Agent tools — the forked
    // agent operates with the same capabilities as the parent.
    const engine = new QueryEngine({
      cwd,
      toolRegistry, // Full parent registry — no tool restrictions
      sessionManager: forkedSessionManager,
      maxTurns: config.maxTurns ?? defaultMaxTurns,
      callModel,
      model,
      customSystemPrompt: systemPrompt,
      agentId, // Worker identity for message queue draining
      mode: 'worker',
    });

    await engine.init();

    try {
      for await (const event of engine.submitMessage(config.prompt)) {
        // Collect structured messages
        if (event.type === 'message' && event.data) {
          const data = event.data as { type?: string; message?: Message };

          if (data.type === 'assistant' && data.message) {
            entry.messages.push(data.message);
            entry.turnCount++;
            // Also build a human-readable transcript line
            entry.transcript.push(messageToLine(data.message));
          } else if (data.type === 'user' && data.message) {
            entry.messages.push(data.message);
          }
        }

        if (event.type === 'error') {
          const errData = event.data as { message?: string } | undefined;
          entry.error = errData?.message ?? 'Unknown error';
          engine.shutdown();
          // resolveDone is called via settle() — we reach it through the forkSession() catch handler
          throw new Error(entry.error);
        }

        if (event.type === 'done') {
          entry.result = extractResultText(entry.messages as Message[]);
          engine.shutdown();

          // ── SubagentStop hook (success) ──────────────────────────
          if (hookManager) {
            const durationMs = Date.now() - startTime;
            const tokenUsage = entry.messages.length; // approximate
            hookManager.onSubagentStop(
              parentSessionId,
              cwd,
              config.description.slice(0, 80),
              true,
              entry.result ?? 'Fork task completed',
              tokenUsage,
              durationMs,
            ).catch(() => { /* non-fatal */ });

            // ── TaskCompleted hook (non-blockable) ─────────────────
            hookManager.onTaskCompleted(
              parentSessionId,
              cwd,
              agentId,
              'completed',
              entry.result ?? 'Fork task completed',
              {
                tokens: tokenUsage,
                toolCalls: entry.turnCount,
                durationMs,
              },
            ).catch(() => { /* non-fatal */ });
          }

          return; // donePromise resolves → forkSession() settles as 'completed'
        }
      }
    } catch (error: unknown) {
      entry.error = error instanceof Error ? error.message : String(error);

      // ── SubagentStop hook (failure) ─────────────────────────────
      if (hookManager) {
        const durationMs = Date.now() - startTime;
        hookManager.onSubagentStop(
          parentSessionId,
          cwd,
          config.description.slice(0, 80),
          false,
          entry.error ?? 'Unknown error',
          0,
          durationMs,
        ).catch(() => { /* non-fatal */ });

        // ── TaskCompleted hook (non-blockable, failed) ────────────
        hookManager.onTaskCompleted(
          parentSessionId,
          cwd,
          agentId,
          'failed',
          entry.error ?? 'Unknown error',
          {
            tokens: 0,
            toolCalls: entry.turnCount,
            durationMs,
          },
        ).catch(() => { /* non-fatal */ });
      }

      throw error; // re-throw to let forkSession()'s .catch() handle settlement
    }
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractResultText(messages: Message[]): string {
  for (const msg of [...messages].reverse()) {
    if (msg.role !== 'assistant') continue;

    if (typeof msg.content === 'string') {
      return msg.content;
    }

    if (Array.isArray(msg.content)) {
      const textBlocks = msg.content.filter((b) => b.type === 'text');
      if (textBlocks.length > 0) {
        return textBlocks.map((b) => b.text ?? '').join('\n');
      }
    }
  }
  return 'Task completed (no text output)';
}

function messageToLine(msg: Message): string {
  if (typeof msg.content === 'string') {
    return `[assistant] ${msg.content.slice(0, 500)}`;
  }
  if (Array.isArray(msg.content)) {
    const parts: string[] = [];
    for (const block of msg.content) {
      if (block.type === 'text' && block.text) {
        parts.push(block.text.slice(0, 300));
      } else if (block.type === 'tool_use') {
        parts.push(`🔧 ${block.name}`);
      } else if (block.type === 'tool_result') {
        const preview = typeof block.content === 'string'
          ? block.content.slice(0, 100)
          : '[result]';
        parts.push(`  ↳ ${preview}`);
      }
    }
    return parts.join('\n');
  }
  return '[assistant message]';
}
