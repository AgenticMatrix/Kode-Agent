/**
 * coder-client.ts — Coder Gateway Adapter
 *
 * Implements IGatewayClient by bridging to coder-agent's QueryEngine
 * (Agent Loop) and translating QueryMessage → GatewayEvent via
 * query-bridge.ts.
 *
 * Config is read from ~/.coder/settings.json.
 */

import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import type { QueryMessage } from '@coder/shared'
import { getSubagentBus } from '@coder/shared'

import type { IGatewayClient } from './client.js'
import type { GatewayEvent } from './types.js'
import { createQueryEngine } from './engine-factory.js'
import type { EngineFactoryResult } from './engine-factory.js'
import {
  createBridgeState,
  bridgeQueryToGateway,
  resetTurnState,
} from './query-bridge.js'
import type { BridgeState } from './query-bridge.js'
import { resolvePermission, getPendingPermissions } from './deferred.js'
import {
  createSession,
  resumeSession,
  listSessions,
  getSessionManager,
  getCheckpointManager,
} from '../services/session-service.js'
import type { SessionManager } from '@coder/core'
import { Compactor } from '@coder/core'

const execFileAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// Config from ~/.coder/settings.json
// ---------------------------------------------------------------------------

interface ModelEntry {
  model: string[]        // List of model IDs available for this provider
  base_url?: string      // Provider endpoint URL
  auth_token_env?: string // API key / auth token
  proxy?: string         // HTTP/HTTPS proxy URL for this provider (e.g. "http://127.0.0.1:7890")
  max_tokens?: number    // Maximum output tokens for this model (default: 32768)
  provider?: string      // e.g. "anthropic", "deepseek", "openai"
  price?: {
    input: number
    output: number
    currency: string
    unit: string
  }
}

function inferProvider(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('deepseek')) return 'deepseek'
  if (lower.includes('openai') || lower.includes('gpt') || lower.includes('o1') || lower.includes('o3') || lower.includes('o4')) return 'openai'
  return 'anthropic'
}

function upsertModelList(list: ModelEntry[], newEntry: ModelEntry): void {
  const idx = list.findIndex(m => m.provider === newEntry.provider)
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...newEntry }
  } else {
    list.push(newEntry)
  }
}

interface ClaudeSettings {
  env?: Record<string, string>
  theme?: string
  model_list?: ModelEntry[]
  default_model?: string
  max_tokens?: number    // Global max output tokens for all providers (default: 32768)
  display?: {
    tui_auto_resume_recent?: boolean
  }
}

function loadClaudeSettings(): ClaudeSettings {
  try {
    const raw = readFileSync(join(homedir(), '.coder', 'settings.json'), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function resolveModelConfig(settings: ClaudeSettings, fallbackModel: string): {
  model: string
  baseUrl?: string
  apiKey?: string
  proxy?: string
  maxTokens?: number
  name: string
  provider: string
} {
  // Helper: parse "provider/model-name" format
  const parseDefaultModel = (raw: string): { providerName: string; modelName: string | undefined } => {
    const parts = raw.split('/')
    return {
      providerName: parts[0],
      modelName: parts.length > 1 ? parts[1] : undefined,
    }
  }

  // Helper: resolve a model from a model_list entry
  const resolveFromEntry = (entry: ModelEntry, preferredModel?: string) => {
    const selectedModel = preferredModel
      ? (entry.model.find(m => m === preferredModel) ?? entry.model[0])
      : entry.model[0]
    return {
      model: selectedModel,
      baseUrl: entry.base_url,
      apiKey: entry.auth_token_env,
      proxy: entry.proxy,
      maxTokens: entry.max_tokens,
      name: selectedModel,
      provider: entry.provider ?? inferProvider(selectedModel),
    }
  }

  // 0. CODER_MODEL env var — highest priority (overrides all other sources)
  const coderModel = process.env.CODER_MODEL
  if (coderModel) {
    if (settings.model_list) {
      // Try parsing as "provider/model-name"
      const { providerName, modelName } = parseDefaultModel(coderModel)
      if (providerName) {
        const entry = settings.model_list.find(m => m.provider === providerName)
        if (entry && entry.model.length > 0) {
          return resolveFromEntry(entry, modelName)
        }
      }
      // Fallback: try matching any model name in any entry's model array
      for (const entry of settings.model_list) {
        const matched = entry.model.find(m => m === coderModel)
        if (matched) {
          return resolveFromEntry(entry, matched)
        }
      }
    }
    // Not in model_list — use directly
    return {
      model: coderModel,
      name: coderModel,
      provider: inferProvider(coderModel),
    }
  }

  // 1. Find default model from model_list using "provider/model-name" format
  const defaultName = settings.default_model
  if (defaultName && settings.model_list) {
    const { providerName, modelName } = parseDefaultModel(defaultName)
    const entry = settings.model_list.find(m => m.provider === providerName)
    if (entry && entry.model.length > 0) {
      return resolveFromEntry(entry, modelName)
    }
  }
  // 2. Fall back to first model in list
  if (settings.model_list && settings.model_list.length > 0) {
    const entry = settings.model_list[0]!
    if (entry.model.length > 0) {
      return resolveFromEntry(entry)
    }
  }
  // 3. Legacy env fallback
  const env = settings.env ?? {}
  return {
    model: env.CODER_MODEL ?? fallbackModel,
    baseUrl: env.CODER_BASE_URL,
    apiKey: env.CODER_AUTH_TOKEN,
    name: fallbackModel,
    provider: 'anthropic',
  }
}

// ---------------------------------------------------------------------------
// CoderGatewayClient constructor options
// ---------------------------------------------------------------------------

export interface CoderGatewayClientOptions {
  /** Enable Coordinator or Worker mode (default: false) */
  coordinatorMode?: boolean
  /** Team identifier for routing */
  teamId?: string
  /** Worker-only mode (default: false) */
  workerMode?: boolean
  /** Maximum concurrent workers in Coordinator mode (default: 3) */
  maxWorkers?: number
  /** Enable extended thinking mode (default: false) */
  thinkingMode?: boolean
  /** Extended thinking budget in tokens (default: 1024) */
  thinkingBudget?: number
  /** Fork from a specific session ID */
  forkSessionId?: string
  /** Turn number to fork from (used with forkSessionId) */
  forkTurn?: number
}

// ---------------------------------------------------------------------------
// CoderGatewayClient
// ---------------------------------------------------------------------------

export class CoderGatewayClient extends EventEmitter implements IGatewayClient {
  private ready = false
  private subscribed = false
  private bufferedEvents: GatewayEvent[] = []
  private logLines: string[] = []
  private model: string
  private conversationMessages: { role: 'user' | 'assistant'; content: string }[] = []

  // ── Coordinator / Worker state ─────────────────────────────────────
  private coordinatorMode: boolean
  private teamId?: string
  private workerMode: boolean
  private maxWorkers: number

  // ── Thinking config ────────────────────────────────────────────────
  private thinkingMode: boolean
  private thinkingBudget: number

  // ── Model config ────────────────────────────────────────────────────
  private modelConfig: { model: string; baseUrl?: string; apiKey?: string; proxy?: string; maxTokens?: number; name: string; provider: string } | null = null

  // ── Session fork config ─────────────────────────────────────────────
  private forkSessionId?: string
  private forkTurn?: number

  // ── QueryEngine + Bridge state ──────────────────────────────────────
  private engineResult: EngineFactoryResult | null = null
  private bridgeState: BridgeState | null = null
  private lastInfoEmitMs = 0
  /** Gateway session ID from session.create RPC — must match engine's sessionId */
  private gatewaySessionId: string | null = null

  constructor(options: CoderGatewayClientOptions = {}) {
    super()
    this.setMaxListeners(0)

    const settings = loadClaudeSettings()

    // CODER_MODEL env var — highest-priority model override.
    // Check before resolveModelConfig so the env var wins over settings.json.
    const coderModel = process.env.CODER_MODEL
    let resolved: { model: string; baseUrl?: string; apiKey?: string; proxy?: string; maxTokens?: number; name: string; provider: string }
    if (coderModel) {
      // Helper: resolve from a model_list entry
      const resolveEntry = (entry: ModelEntry, preferredModel?: string) => {
        const selectedModel = preferredModel
          ? (entry.model.find(m => m === preferredModel) ?? entry.model[0])
          : entry.model[0]
        return {
          model: selectedModel,
          baseUrl: entry.base_url,
          apiKey: entry.auth_token_env,
          proxy: entry.proxy,
          maxTokens: entry.max_tokens,
          name: selectedModel,
          provider: entry.provider ?? inferProvider(selectedModel),
        }
      }

      // Try parsing as "provider/model-name"
      const parts = coderModel.split('/')
      const providerName = parts.length > 1 ? parts[0] : undefined
      const modelName = parts.length > 1 ? parts[1] : parts[0]

      // Default fallback
      let entryResult: ReturnType<typeof resolveEntry> | null = null

      if (settings.model_list && settings.model_list.length > 0) {
        // Try matching by provider first
        const entry = providerName
          ? settings.model_list.find(m => m.provider === providerName)
          : undefined
        if (entry && entry.model.length > 0) {
          entryResult = resolveEntry(entry, modelName)
        } else {
          // Fallback: try matching any model name in any model array
          for (const e of settings.model_list) {
            const matched = e.model.find(m => m === modelName)
            if (matched) {
              entryResult = resolveEntry(e, matched)
              break
            }
          }
        }
      }

      resolved = entryResult ?? { model: modelName, name: modelName, provider: providerName ?? inferProvider(modelName) }
    } else {
      resolved = resolveModelConfig(settings, 'claude-sonnet-4-6')
    }

    this.model = resolved.model
    this.modelConfig = resolved

    // ── Coordinator / Worker mode ───────────────────────────────────
    this.coordinatorMode =
      options.coordinatorMode === true ||
      process.env.CODER_COORDINATOR_MODE === 'true'
    this.workerMode =
      options.workerMode === true ||
      process.env.CODER_WORKER_MODE === 'true'
    this.teamId = options.teamId ?? process.env.CODER_TEAM_ID
    this.maxWorkers = options.maxWorkers ?? 3
    this.thinkingMode =
      options.thinkingMode === true ||
      process.env.CODER_THINKING_MODE === 'true'
    this.thinkingBudget =
      options.thinkingBudget ??
      (process.env.CODER_THINKING_BUDGET ? parseInt(process.env.CODER_THINKING_BUDGET, 10) : undefined) ??
      1024
    this.forkSessionId = options.forkSessionId
    this.forkTurn = options.forkTurn

    // Engine is created lazily on first prompt submission so that
    // cwd / config are settled by the time the user types.
  }

  // ── IGatewayClient impl ──────────────────────────────────────────

  start(): void {
    this.ready = true
    const modeTag = this.coordinatorMode ? ' coordinator' : this.workerMode ? ' worker' : ''
    this.log(`gateway started (coder TypeScript backend, model=${this.model}${modeTag})`)
    this.publish({ type: 'gateway.ready' })
  }

  kill(_reason?: string): void {
    this.ready = false
    this.subscribed = false
    this.bufferedEvents.length = 0
    if (this.engineResult) {
      this.engineResult.interrupt()
      this.engineResult = null
      this.bridgeState = null
    }
  }

  drain(): void {
    this.subscribed = true
    for (const ev of this.bufferedEvents) {
      this.emit('event', ev)
    }
    this.bufferedEvents.length = 0
  }

  getLogTail(limit = 20): string {
    return this.logLines.slice(-Math.max(1, limit)).join('\n')
  }

  async request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    try {
      switch (method) {
        // ── Session ──────────────────────────────────────────
        case 'session.create': {
          const { session, checkpoint } = await createSession({
            cwd: (params?.cwd as string) ?? process.cwd(),
            model: (params?.model as string) ?? this.model,
          })
          // Store the gateway session ID so the engine uses the same ID.
          // Without this, the TUI filters out all bridge events because
          // the engine generates a different random UUID.
          this.gatewaySessionId = session.id
          const sm = getSessionManager()
          const info = sm.get(session.id)
          return {
            session_id: session.id,
            info: info ? { id: info.id, title: info.title, status: info.status, turnCount: info.turnCount, cwd: info.cwd, model: info.model } : null,
            messages: [],
          } as unknown as T
        }

        case 'session.resume': {
          const sessionId = (params?.session_id as string) ?? ''
          const { session } = await resumeSession(sessionId)
          // Sync the gateway session ID so the engine uses the same ID.
          // Without this, the engine generates a different UUID and the
          // TUI event filter drops all bridge events (silent model).
          this.gatewaySessionId = session.id
          const sm = getSessionManager()
          const info = sm.get(session.id)
          return {
            session_id: session.id,
            info: info ? { id: info.id, title: info.title, status: info.status, turnCount: info.turnCount, cwd: info.cwd, model: info.model } : null,
            messages: session.messages.map(m => ({
              role: m.role,
              text: typeof m.content === 'string' ? m.content : '',
              context: JSON.stringify(m),
            })),
          } as unknown as T
        }

        case 'session.list': {
          const sessions = listSessions(20)
          return sessions.map(s => ({
            id: s.id,
            title: s.title,
            message_count: s.turnCount,
            preview: '',
            started_at: s.createdAt,
          })) as unknown as T
        }

        case 'session.active_list':
          return [] as unknown as T

        case 'session.most_recent': {
          const sessions = listSessions(1)
          if (sessions.length > 0) {
            const s = sessions[0]!
            return { session_id: s.id, title: s.title, started_at: s.createdAt } as unknown as T
          }
          return { session_id: null } as unknown as T
        }

        case 'session.interrupt': {
          // Forward interrupt to the QueryEngine's AbortController.
          // This aborts the in-progress Agent Loop turn without
          // destroying the engine (unlike kill() which nulls it).
          if (this.engineResult) {
            // Resolve all pending deferred permissions with false so
            // the Agent Loop doesn't hang forever waiting for approval.
            for (const [toolUseId] of getPendingPermissions()) {
              resolvePermission(toolUseId, false)
            }
            this.engineResult.interrupt()
            this.log('session interrupted by user')
          }
          return { interrupted: true } as unknown as T
        }

        case 'session.activate':
        case 'session.title':
        case 'session.save':
        case 'session.close':
        case 'session.delete':
        case 'session.undo':
        case 'session.branch':
        case 'session.steer':
        case 'session.status':
        case 'session.usage':
          return null as unknown as T

        case 'session.compress': {
          const sessionId = (params?.session_id as string) || this.gatewaySessionId
          if (!sessionId) {
            return { removed: 0, after_messages: 0, before_messages: 0 } as unknown as T
          }
          const session = getSessionManager().get(sessionId)
          if (!session || session.messages.length === 0) {
            return { removed: 0, after_messages: 0, before_messages: 0 } as unknown as T
          }
          const beforeMessages = session.messages.length
          this.publish({
            type: 'status.update',
            payload: { text: 'Compressing conversation…', kind: 'info' },
          } as GatewayEvent)
          const compactor = new Compactor({ summarizeEnabled: false })
          const contextBudget = 180_000
          const budget = compactor.computeBudget(session.messages, contextBudget)
          if (!compactor.needsCompaction(session.messages, contextBudget)) {
            this.publish({
              type: 'status.update',
              payload: { text: 'Context is within budget — no compaction needed', kind: 'info' },
            } as GatewayEvent)
            return { removed: 0, before_messages: beforeMessages, after_messages: beforeMessages, before_tokens: budget.current, after_tokens: budget.current } as unknown as T
          }
          try {
            const result = await compactor.compact(session.messages, contextBudget)
            session.messages = result.messages
            this.publish({
              type: 'status.update',
              payload: { text: `Compacted: ${result.messagesRemoved} messages removed, ${result.beforeTokens.toLocaleString()} → ${result.afterTokens.toLocaleString()} tokens`, kind: 'info' },
            } as GatewayEvent)
            return { removed: result.messagesRemoved, before_messages: beforeMessages, after_messages: result.messages.length, before_tokens: result.beforeTokens, after_tokens: result.afterTokens, summary: result.summary ? { note: result.summary } : undefined } as unknown as T
          } catch {
            return { removed: 0, after_messages: beforeMessages, before_messages: beforeMessages } as unknown as T
          }
        }

        // ── Config ────────────────────────────────────────────
        case 'config.full': {
          const settings = loadClaudeSettings()
          const resolved = resolveModelConfig(settings, 'claude-sonnet-4-6')
          return {
            config: {
              display: {
                bell_on_complete: false,
                busy_input_mode: 'interrupt',
                details_mode: 'auto',
                inline_diffs: true,
                mouse_tracking: true,
                sections: {},
                show_cost: true,
                show_reasoning: true,
                streaming: true,
                thinking_mode: 'full',
                tui_auto_resume_recent: settings.display?.tui_auto_resume_recent ?? false,
                tui_compact: false,
                tui_status_indicator: 'kaomoji',
                tui_statusbar: 'bottom',
              },
              model: resolved.model,
              base_url: resolved.baseUrl ?? '',
            },
          } as unknown as T
        }

        case 'config.get': {
          const key = (params?.key as string) ?? ''
          switch (key) {
            case 'full': {
              const settings = loadClaudeSettings()
              const resolved = resolveModelConfig(settings, 'claude-sonnet-4-6')
              return {
                config: {
                  display: {
                    bell_on_complete: false,
                    busy_input_mode: 'interrupt',
                    details_mode: 'auto',
                    inline_diffs: true,
                    mouse_tracking: true,
                    sections: {},
                    show_cost: true,
                    show_reasoning: true,
                    streaming: true,
                    thinking_mode: 'full',
                    tui_auto_resume_recent: settings.display?.tui_auto_resume_recent ?? false,
                    tui_compact: false,
                    tui_status_indicator: 'kaomoji',
                    tui_statusbar: 'bottom',
                  },
                  model: resolved.model,
                  base_url: resolved.baseUrl ?? '',
                },
              } as unknown as T
            }
            case 'mtime': {
              return { mtime: Date.now() } as unknown as T
            }
            default: {
              const settings = loadClaudeSettings()
              const env = settings.env ?? {}
              return { value: env[key] ?? '' } as unknown as T
            }
          }
        }

        case 'config.mtime':
          return { mtime: Date.now() } as unknown as T
        case 'config.get_value': {
          const gkey = (params?.key as string) ?? ''
          const settings3 = loadClaudeSettings()
          const env3 = settings3.env ?? {}
          return { value: env3[gkey] ?? '' } as unknown as T
        }
        case 'config.set': {
          const key = (params?.key as string) ?? ''
          const value = (params?.value as string) ?? ''
          const settings = loadClaudeSettings()

          if (key === 'model' && value) {
            // default_model format: "provider/model-name" (e.g., "deepseek/deepseek-v4-pro")
            const parts = value.split('/')
            const providerName = parts[0]
            const modelName = parts.length > 1 ? parts[1] : undefined

            const modelList = settings.model_list ?? []
            const entry = modelList.find(m => m.provider === providerName)

            if (entry && entry.model.length > 0) {
              const selectedModel = modelName
                ? (entry.model.find(m => m === modelName) ?? entry.model[0])
                : entry.model[0]

              // Update env vars in settings to match the selected model entry
              settings.env = settings.env ?? {}
              settings.env.CODER_MODEL = selectedModel
              if (entry.base_url) settings.env.CODER_BASE_URL = entry.base_url
              if (entry.auth_token_env) settings.env.CODER_AUTH_TOKEN = entry.auth_token_env
              settings.default_model = value

              // Smart merge into model_list (match by provider)
              upsertModelList(modelList, entry)
              settings.model_list = modelList

              // Persist to disk
              writeFileSync(
                join(homedir(), '.coder', 'settings.json'),
                JSON.stringify(settings, null, 2),
              )

              // Update runtime state
              this.model = selectedModel
              this.modelConfig = {
                model: selectedModel,
                baseUrl: entry.base_url,
                apiKey: entry.auth_token_env,
                name: selectedModel,
                provider: entry.provider ?? inferProvider(selectedModel),
              }
              this.log(`config.set model=${value} -> ${selectedModel} (provider=${this.modelConfig.provider})`)
            }
          } else if (key === 'CODER_MODEL' && value) {
            // Direct default_model set: format as "provider/model-name"
            const parts = value.split('/')
            const providerName = parts[0]
            const modelName = parts.length > 1 ? parts[1] : value

            settings.env = settings.env ?? {}
            settings.env.CODER_MODEL = value
            settings.model_list = settings.model_list ?? []
            const existingIdx = settings.model_list.findIndex(
              (m: ModelEntry) => m.provider === providerName
            )
            if (existingIdx >= 0) {
              const existing = settings.model_list[existingIdx]
              if (!existing.model.includes(modelName)) {
                existing.model = [modelName, ...existing.model]
              }
            } else {
              settings.model_list.push({ model: [modelName], provider: providerName })
            }
            settings.default_model = value
            writeFileSync(
              join(homedir(), '.coder', 'settings.json'),
              JSON.stringify(settings, null, 2),
            )
            this.log(`config.set CODER_MODEL=${value}`)
          } else {
            // Generic key: update env[key] in settings and persist
            settings.env = settings.env ?? {}
            settings.env[key] = value
            // Also update the current default model entry in model_list
            if (settings.model_list && settings.default_model) {
              const parts = settings.default_model.split('/')
              const providerName = parts[0]
              const defEntry = settings.model_list.find((m: ModelEntry) => m.provider === providerName)
              if (defEntry) {
                if (key === 'CODER_BASE_URL') defEntry.base_url = value
                if (key === 'CODER_AUTH_TOKEN') defEntry.auth_token_env = value
              }
            }
            writeFileSync(
              join(homedir(), '.coder', 'settings.json'),
              JSON.stringify(settings, null, 2),
            )
            this.log(`config.set ${key}=${value}`)
          }

          return { key, value } as unknown as T
        }

        // ── Commands ───────────────────────────────────────────
        case 'commands.catalog':
          return { categories: [], pairs: [], skill_count: 0 } as unknown as T

        case 'completion':
          return { items: [] } as unknown as T

        case 'slash.exec':
        case 'command.dispatch':
          return null as unknown as T

        // ── Shell ──────────────────────────────────────────────
        case 'shell.exec': {
          const cmd = (params?.command as string) ?? ''
          try {
            const { stdout, stderr } = await execFileAsync('sh', ['-c', cmd], {
              timeout: 30000,
              maxBuffer: 1024 * 1024,
            })
            return { code: 0, stdout, stderr } as unknown as T
          } catch (err: unknown) {
            const e = err as { code?: number; stdout?: string; stderr?: string }
            return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' } as unknown as T
          }
        }

        // ── Prompt ─────────────────────────────────────────────
        case 'prompt.submit': {
          const userText = (params?.text as string) ?? ''
          void this.submitPrompt(userText)
          return { accepted: true } as unknown as T
        }

        // ── Approval ───────────────────────────────────────────
        case 'approval.respond': {
          const choice = (params?.choice as string) ?? 'deny'
          // TUI sends 'once' / 'session' / 'always' / 'deny' (see prompts.tsx OPTS).
          // Any choice other than 'deny' means the user approved the tool.
          const allowed = choice !== 'deny'
          const requestId = params?.request_id as string | undefined

          // Resolve via bridgeState.pendingApprovals which holds the actual
          // DeferredPermission object from the Agent Loop. We must resolve
          // the deferred here directly because query.ts creates DeferredPermission
          // inline (System A) WITHOUT registering in deferred.ts's global
          // pendingPermissions Map (System B). Calling resolvePermission()
          // would look up an empty Map → silent no-op → Agent Loop hangs forever.
          const approval = requestId
            ? this.bridgeState?.pendingApprovals.find((a) => a.toolUseId === requestId)
            : this.bridgeState?.pendingApprovals[0];

          if (approval) {
            // Resolve the Agent Loop's inline DeferredPermission directly
            approval.deferred.resolve(allowed);
            // Also try the global Map for other consumers
            resolvePermission(approval.toolUseId, allowed);
          }

          return { resolved: true, allowed } as unknown as T
        }

        // ── Model ──────────────────────────────────────────────
        case 'model.options':
          return { model: this.model, providers: [] } as unknown as T

        // ── Tools / MCP ────────────────────────────────────────
        case 'tools.configure':
        case 'mcp.reload':
        case 'env.reload':
        case 'process.stop':
        case 'browser.manage':
          return null as unknown as T

        // ── Delegation ─────────────────────────────────────────
        case 'delegation.status':
          return { max_spawn_depth: 3, max_concurrent_children: 5, paused: false } as unknown as T

        case 'delegation.pause':
        case 'subagent.interrupt':
          return null as unknown as T

        // ── Spawn tree ─────────────────────────────────────────
        case 'spawn-tree.list':
          return [] as unknown as T

        case 'spawn-tree.load':
          return null as unknown as T

        // ── Setup ──────────────────────────────────────────────
        case 'setup.status':
          return { provider_configured: this.hasProvider() } as unknown as T

        // ── Rollback ───────────────────────────────────────────
        case 'rollback.list':
          return [] as unknown as T

        case 'rollback.diff':
        case 'rollback.restore':
          return null as unknown as T

        // ── Voice ──────────────────────────────────────────────
        case 'voice.toggle':
        case 'voice.record':
          return null as unknown as T

        // ── Coordinator ─────────────────────────────────────────
        case 'coordinator.mode': {
          return {
            enabled: this.coordinatorMode,
            team_id: this.teamId ?? null,
            worker_mode: this.workerMode,
            max_workers: this.maxWorkers,
            env_coordinator: process.env.CODER_COORDINATOR_MODE === 'true',
            env_team_id: process.env.CODER_TEAM_ID ?? null,
          } as unknown as T
        }

        case 'coordinator.tasks': {
          const bus = getSubagentBus()
          const runningIds = bus.getRunningIds()
          const tasks = runningIds.map((id) => {
            const entry = bus.get(id)
            return {
              id,
              description: entry?.description ?? '',
              status: entry?.status ?? 'unknown',
              subagent_type: entry?.subagentType ?? 'general-purpose',
            }
          })
          return {
            tasks,
            running_count: bus.runningCount,
            total_tracked: bus.listAll().length,
          } as unknown as T
        }

        // ── Misc ───────────────────────────────────────────────
        case 'terminal.resize':
        case 'clipboard.paste':
        case 'input.detect_drop':
        case 'image.attach':
          return null as unknown as T

        default:
          this.log(`unhandled RPC: ${method}`)
          return null as unknown as T
      }
    } catch (err) {
      this.log(`RPC error: ${method} — ${err instanceof Error ? err.message : String(err)}`)
      throw err
    }
  }

  // ── Engine initialisation ─────────────────────────────────────────

  private ensureEngine(): void {
    if (this.engineResult) return

    const settings = loadClaudeSettings()
    const env = settings.env ?? {}

    // Resolve API key: env var, model_list entry, or env CODER_AUTH_TOKEN
    const modelCfg = this.modelConfig
    const apiKey =
      process.env.CODER_AUTH_TOKEN ??
      modelCfg?.apiKey ??
      env.CODER_AUTH_TOKEN ??
      ''

    const baseUrl =
      modelCfg?.baseUrl ??
      env.CODER_BASE_URL ??
      process.env.CODER_BASE_URL

    const proxy =
      (modelCfg as any)?.proxy ??
      env.CODER_PROXY ??
      process.env.CODER_PROXY

    // Resolve maxTokens: env var > per-model entry > global settings > undefined (uses provider default)
    const maxTokens =
      process.env.CODER_MAX_TOKENS
        ? parseInt(process.env.CODER_MAX_TOKENS, 10)
        : (modelCfg?.maxTokens ?? settings.max_tokens)

    // Check CODER_COORDINATOR_MODE env var (set by entry.tsx or manually)
    const coordinatorMode =
      this.coordinatorMode ||
      process.env.CODER_COORDINATOR_MODE === 'true'

    // Share the gateway's singleton SessionManager with the engine.
    // This ensures session.create RPC (gateway) and engine tool execution
    // tracking / message persistence use the same sessions Map. Without
    // this, the engine's internal SessionManager tracks messages in a
    // separate copy, causing session state divergence.
    const sessionManager = getSessionManager()

    this.engineResult = createQueryEngine({
      cwd: process.cwd(),
      apiKey,
      baseUrl: baseUrl || undefined,
      proxy: proxy || undefined,
      model: this.model,
      providerName: modelCfg?.provider,
      maxTurns: 100,
      maxTokens,
      sessionId: this.gatewaySessionId ?? undefined,
      sessionManager,
      coordinatorMode,
      teamId: this.teamId,
      thinkingMode: this.thinkingMode,
      thinkingBudget: this.thinkingBudget,
    })

    this.bridgeState = createBridgeState(this.engineResult.sessionId)
    this.bridgeState.model = this.model

    const roleTag = this.engineResult.roleLabel !== 'default'
      ? `, role=${this.engineResult.roleLabel}`
      : ''

    if (apiKey) {
      this.log(`engine initialised (session=${this.engineResult.sessionId.slice(0, 8)}, model=${this.model}${roleTag})`)
    } else {
      this.log(`engine initialised without API key (mock mode)${roleTag}`)
    }
  }

  // ── Prompt submission (Agent Loop via QueryEngine) ──────────────────

  private async submitPrompt(userText: string): Promise<void> {
    // Lazy-init engine on first prompt
    this.ensureEngine()

    if (!this.engineResult || !this.bridgeState) {
      this.publish({ type: 'message.start' })
      this.publish({
        type: 'message.delta',
        payload: {
          text: '**Engine initialisation failed.**\n\nCheck that the configuration is valid.',
        },
      })
      this.publish({ type: 'message.complete' })
      this.publish({ type: 'status.update', payload: { text: 'Ready' } })
      return
    }

    const { engine } = this.engineResult

    this.publish({ type: 'message.start' })

    // ── Coordinator mode: task allocation preamble ─────────────────
    if (this.coordinatorMode) {
      const bus = getSubagentBus()
      this.publish({
        type: 'status.update',
        payload: {
          text: `Coordinator mode — ${bus.runningCount} active worker(s), ${this.maxWorkers} max`,
          kind: 'info',
        },
      })
      // TODO (Phase 2): Coordinator task allocation loop —
      //   After each turn, check for idle workers and assign pending
      //   sub-tasks from the task queue. The Agent Loop already drains
      //   completed agents via SubagentBus at the start of each turn
      //   (see query.ts:subagentBus.drainCompleted()).
      this.log(`coordinator: task allocation placeholder (workers=${this.maxWorkers})`)
    }

    // Initial status — bridge will override with 'Thinking…' / 'Generating…'
    // once stream events arrive. This avoids a flash of 'ready' during API call setup.
    this.publish({ type: 'status.update', payload: { text: 'Thinking…' } })

    let wasCompleteEmitted = false

    try {
      for await (const queryEvent of engine.submitMessage(userText)) {
        switch (queryEvent.type) {
          case 'message': {
            // queryEvent.data is a QueryMessage from the Agent Loop
            const queryMsg = queryEvent.data as QueryMessage
            const gatewayEvents = bridgeQueryToGateway(queryMsg, this.bridgeState)
            for (const ev of gatewayEvents) {
              if (ev.type === 'message.complete') wasCompleteEmitted = true
              this.publish(ev)
            }
            break
          }

          case 'permission_required': {
            // Agent Loop suspended — user must approve/deny the tool.
            // Pass through as a system permission_required QueryMessage
            // so bridgeQueryToGateway emits approval.request.
            const permissionMsg: QueryMessage = {
              type: 'system',
              subtype: 'permission_required',
              deferred: queryEvent.deferred!,
            }
            const gatewayEvents = bridgeQueryToGateway(permissionMsg, this.bridgeState)
            for (const ev of gatewayEvents) {
              this.publish(ev)
            }
            break
          }

          case 'compact': {
            this.publish({
              type: 'status.update',
              payload: { text: 'Compressing context...', kind: 'info' },
            })
            break
          }

          case 'error': {
            const errData = queryEvent.data as { message?: string } | undefined
            this.publish({
              type: 'error',
              payload: { message: errData?.message ?? 'Unknown error' },
            })
            break
          }

          case 'cost': {
            // Cost updates are handled inside bridge state accumulation
            break
          }

          case 'done':
            // Turn complete — final cleanup handled below
            break
        }

        // Throttled status update: emit session.info every 5s so the
        // status bar shows live turn count / tokens / cost.
        const now = Date.now()
        if (now - this.lastInfoEmitMs >= 5000 && this.bridgeState) {
          this.lastInfoEmitMs = now
          this.publish({
            type: 'session.info',
            payload: {
              model: this.model,
              skills: {},
              tools: {},
              usage: {
                calls: this.bridgeState.turnCount,
                input: this.bridgeState.usage.inputTokens,
                output: this.bridgeState.usage.outputTokens,
                total: this.bridgeState.usage.inputTokens + this.bridgeState.usage.outputTokens,
                cost_usd: this.bridgeState.totalCost,
              },
            },
          })
        }
      }

      // message.complete is normally emitted by handleAssistantMessage in the bridge.
      // If the bridge didn't emit it (e.g. mock provider edge cases), publish a
      // fallback so the TUI always transitions busy → false.
      if (!wasCompleteEmitted) {
        this.publish({
          type: 'message.complete',
          payload: {
            text: this.bridgeState.accumulatedText || '',
            usage: {
              calls: 1,
              input: this.bridgeState.usage.inputTokens,
              output: this.bridgeState.usage.outputTokens,
              total: this.bridgeState.usage.inputTokens + this.bridgeState.usage.outputTokens,
              cost_usd: this.bridgeState.totalCost,
            },
          },
        })
      }
      resetTurnState(this.bridgeState)
      this.publish({ type: 'status.update', payload: { text: 'Ready' } })

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log(`Prompt error: ${message}`)
      this.publish({
        type: 'error',
        payload: { message: `Agent error: ${message}` },
      })
      this.publish({
        type: 'status.update',
        payload: { text: 'Error', kind: 'error' },
      })
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private hasProvider(): boolean {
    if (this.engineResult) return true
    const settings = loadClaudeSettings()
    const env = settings.env ?? {}

    // Check model_list entries
    if (settings.model_list && settings.model_list.length > 0) {
      const defaultName = settings.default_model
      let entry: ModelEntry | undefined
      if (defaultName) {
        const parts = defaultName.split('/')
        const providerName = parts[0]
        entry = settings.model_list.find(m => m.provider === providerName)
      }
      if (!entry) entry = settings.model_list[0]
      // Check if auth_token_env looks like a real value (not placeholder)
      const tokenValue = entry?.auth_token_env ?? '';
      if (tokenValue && !tokenValue.startsWith('YOUR_') && !tokenValue.includes('API_KEY') && !tokenValue.includes('NO_KEY')) {
        return true
      }
    }

    // Legacy env check
    return Boolean(
      process.env.CODER_AUTH_TOKEN ||
      env.CODER_AUTH_TOKEN,
    )
  }

  private publish(ev: Partial<GatewayEvent>): void {
    const event = ev as GatewayEvent
    if (this.subscribed) {
      this.emit('event', event)
    } else {
      this.bufferedEvents.push(event)
    }
  }

  private log(msg: string): void {
    this.logLines.push(`[coder-gw] ${msg}`)
  }
}
