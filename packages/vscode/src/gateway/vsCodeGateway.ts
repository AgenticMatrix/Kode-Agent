/**
 * vsCodeGateway.ts — VSCodeGatewayClient
 *
 * Embeds the QueryEngine from @coder/core and bridges the Agent Loop
 * to the VS Code webview via postMessage. Reuses the shared bridge
 * layer (@coder/bridge) for QueryMessage → GatewayEvent translation.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  QueryEngine,
  ToolRegistry,
  SessionManager,
} from '@coder/core';
import type { Provider, ProviderConfig } from '@coder/provider';
import { AnthropicProvider, OpenAICompatProvider, DeepSeekProvider } from '@coder/provider';
import {
  BashTool,
  ReadTool,
  WriteTool,
  EditTool,
  GlobTool,
  GrepTool,
  GitTool,
  TodoWriteTool,
  WebFetchTool,
  WebSearchTool,
  AskUserQuestionTool,
  NotebookEditTool,
  LSPTool,
  SkillTool,
  CronCreateTool,
  CronDeleteTool,
  CronListTool,
  EnterWorktreeTool,
  ExitWorktreeTool,
} from '@coder/tools';
import type { BaseTool, QueryMessage } from '@coder/shared';
import { createBridgeState, bridgeQueryToGateway, resetTurnState } from '@coder/bridge';
import type { BridgeState } from '@coder/bridge';
import { gatewayToWebview } from './gatewayToWebview';
import type { WebviewOutboundMessage, SessionSummary } from '../types/webviewProtocol';

// ── Settings helper ──────────────────────────────────────────────────────

interface CoderSettings {
  env?: Record<string, string>;
  model_list?: Array<{
    model: string[];
    base_url?: string;
    auth_token_env?: string;
    proxy?: string;
    provider?: string;
    max_tokens?: number;
  }>;
  default_model?: string;
  max_tokens?: number;
}

function loadSettings(): CoderSettings {
  try {
    const raw = readFileSync(join(homedir(), '.coder', 'settings.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function resolveApiKey(settings: CoderSettings): string {
  // 1. Environment variable
  const envKey = process.env.CODER_API_KEY || process.env.CODER_AUTH_TOKEN;
  if (envKey) return envKey;

  // 2. settings.json env block
  const env = settings.env ?? {};
  if (env.CODER_API_KEY) return env.CODER_API_KEY;
  if (env.CODER_AUTH_TOKEN) return env.CODER_AUTH_TOKEN;

  // 3. model_list entry's auth_token_env
  const modelList = settings.model_list ?? [];
  for (const entry of modelList) {
    const tokenValue = entry.auth_token_env ?? '';
    if (tokenValue && !tokenValue.startsWith('YOUR_') && !tokenValue.includes('API_KEY') && !tokenValue.includes('NO_KEY')) {
      return tokenValue;
    }
  }

  return '';
}

function createProvider(name: string, config: ProviderConfig, apiKey: string): Provider {
  const cfg = { ...config, apiKey };
  const isAnthropicEndpoint = cfg.baseUrl?.includes('/anthropic');
  switch (name) {
    case 'openai':
      return new OpenAICompatProvider(cfg, 'openai');
    case 'deepseek':
      if (isAnthropicEndpoint) return new AnthropicProvider(cfg);
      return new DeepSeekProvider(cfg);
    case 'anthropic':
    default:
      return new AnthropicProvider(cfg);
  }
}

function resolveProviderName(settings: CoderSettings): string {
  if (process.env.CODER_PROVIDER) return process.env.CODER_PROVIDER;
  const model = process.env.CODER_MODEL || settings.default_model || '';
  const lower = model.toLowerCase();
  if (lower.includes('deepseek')) return 'deepseek';
  if (lower.includes('gpt') || lower.includes('openai') || lower.includes('o1') || lower.includes('o3') || lower.includes('o4')) return 'openai';
  // Check model_list provider
  const modelList = settings.model_list ?? [];
  if (modelList.length > 0 && modelList[0]?.provider) {
    return modelList[0].provider;
  }
  return 'anthropic';
}

function resolveModel(settings: CoderSettings): string {
  // 1. Env var
  if (process.env.CODER_MODEL) return process.env.CODER_MODEL;

  // 2. default_model from settings
  if (settings.default_model) {
    // Format: "provider/model-name" → extract model-name
    const parts = settings.default_model.split('/');
    if (parts.length > 1) return parts[1]!;
  }

  // 3. First model in model_list
  const modelList = settings.model_list ?? [];
  if (modelList.length > 0 && modelList[0]!.model.length > 0) {
    return modelList[0]!.model[0]!;
  }

  return 'claude-sonnet-4-6';
}

type MessageSender = (msg: WebviewOutboundMessage) => void;

// Full tool set matching the CLI
const ALL_TOOLS: BaseTool[] = [
  new BashTool(),
  new ReadTool(),
  new WriteTool(),
  new EditTool(),
  new GlobTool(),
  new GrepTool(),
  new GitTool(),
  new TodoWriteTool(),
  new WebFetchTool(),
  new WebSearchTool(),
  new AskUserQuestionTool(),
  new NotebookEditTool(),
  new LSPTool(),
  new SkillTool(),
  new CronCreateTool(),
  new CronDeleteTool(),
  new CronListTool(),
  new EnterWorktreeTool(),
  new ExitWorktreeTool(),
];

export class VSCodeGatewayClient {
  private sendMessage: MessageSender;
  private engine: QueryEngine | null = null;
  private bridgeState: BridgeState | null = null;
  private sessionManager: SessionManager;
  private toolRegistry: ToolRegistry;
  private provider: Provider | null = null;
  private model: string;
  private providerName: string;
  private cwd: string;
  private sessionId: string;

  constructor(sendMessage: MessageSender) {
    this.sendMessage = sendMessage;
    this.sessionManager = new SessionManager();
    this.cwd = process.cwd();

    // Register tools
    this.toolRegistry = new ToolRegistry();
    this.toolRegistry.registerAll(ALL_TOOLS);

    // Config — read from env vars + ~/.coder/settings.json
    const settings = loadSettings();
    const apiKey = resolveApiKey(settings);
    this.model = resolveModel(settings);
    this.providerName = resolveProviderName(settings);

    if (apiKey) {
      const providerConfig: ProviderConfig = {
        apiKey: '',
        timeout: 300_000,
        maxRetries: 3,
      };
      this.provider = createProvider(this.providerName, providerConfig, apiKey);
      this.sendMessage({
        type: 'configUpdate',
        config: { model: this.model, provider: this.providerName, permissionMode: 'ask' },
      });
      this.sendMessage({
        type: 'statusUpdate',
        status: 'ready',
        message: `Ready — model: ${this.model}`,
        sessionId: '',
      });
    } else {
      this.sendMessage({
        type: 'errorMessage',
        message: 'No API key found. Set CODER_API_KEY env var or configure ~/.coder/settings.json',
      });
      this.sendMessage({
        type: 'statusUpdate',
        status: 'error',
        message: 'No API key configured',
        sessionId: '',
      });
    }

    // Create a default session
    const session = this.sessionManager.create({
      cwd: this.cwd,
      model: this.model,
      provider: this.providerName,
      title: 'VS Code Session',
    });
    this.sessionId = session.id;

    // Send initial session info
    if (apiKey) {
      this.sendMessage({
        type: 'sessionSwitched',
        sessionId: this.sessionId,
        title: session.title || 'Untitled',
      });
    }
  }

  async submitPrompt(text: string): Promise<void> {
    const sessionId = this.sessionId;

    // Auto-title: use first user message as session title
    const session = this.sessionManager.get(sessionId);
    if (session && session.title === 'VS Code Session') {
      const title = text.length > 50 ? text.slice(0, 50) + '...' : text;
      session.title = title;
      this.sendMessage({
        type: 'sessionSwitched',
        sessionId: this.sessionId,
        title,
      });
    }

    if (!this.provider) {
      this.sendMessage({ type: 'errorMessage', message: 'No API key configured. Set CODER_API_KEY or check ~/.coder/settings.json' });
      this.sendMessage({ type: 'statusUpdate', status: 'error', message: 'No API key', sessionId });
      return;
    }

    // Lazily create engine on first prompt
    if (!this.engine) {
      this.createEngine();
    }

    if (!this.engine || !this.bridgeState) {
      this.sendMessage({ type: 'errorMessage', message: 'Engine not initialized.' });
      this.sendMessage({ type: 'statusUpdate', status: 'error', message: 'Engine init failed', sessionId });
      return;
    }

    this.sendMessage({ type: 'statusUpdate', status: 'thinking', sessionId });

    let wasCompleteEmitted = false;

    try {
      for await (const queryEvent of this.engine.submitMessage(text)) {
        switch (queryEvent.type) {
          case 'message': {
            const queryMsg = queryEvent.data as QueryMessage;
            const gatewayEvents = bridgeQueryToGateway(queryMsg, this.bridgeState);
            for (const ev of gatewayEvents) {
              if (ev.type === 'message.complete') wasCompleteEmitted = true;
              const wm = gatewayToWebview(ev, sessionId);
              for (const msg of wm) {
                this.sendMessage(msg);
              }
            }
            break;
          }

          case 'permission_required': {
            const permissionMsg: QueryMessage = {
              type: 'system',
              subtype: 'permission_required',
              deferred: queryEvent.deferred!,
            };
            const gatewayEvents = bridgeQueryToGateway(permissionMsg, this.bridgeState);
            for (const ev of gatewayEvents) {
              const wm = gatewayToWebview(ev, sessionId);
              for (const msg of wm) {
                this.sendMessage(msg);
              }
            }
            break;
          }

          case 'compact':
            this.sendMessage({
              type: 'statusUpdate',
              status: 'ready',
              message: 'Compressing context...',
              sessionId,
            });
            break;

          case 'error': {
            const errData = queryEvent.data as { message?: string } | undefined;
            this.sendMessage({ type: 'errorMessage', message: errData?.message ?? 'Unknown error' });
            break;
          }

          case 'cost':
          case 'done':
            break;
        }
      }

      if (!wasCompleteEmitted && this.bridgeState) {
        this.sendMessage({
          type: 'messageComplete',
          text: this.bridgeState.accumulatedText || '',
          sessionId,
        });
      }

      if (this.bridgeState) {
        resetTurnState(this.bridgeState);
      }

      this.sendMessage({ type: 'statusUpdate', status: 'ready', sessionId });

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Check for common API errors
      let friendlyMsg = message;
      if (message.includes('401') || message.includes('Unauthorized') || message.includes('invalid_api_key')) {
        friendlyMsg = 'API key is invalid. Check your key in ~/.coder/settings.json or CODER_API_KEY env var.';
      } else if (message.includes('429') || message.includes('rate_limit')) {
        friendlyMsg = 'Rate limited. Please wait a moment and try again.';
      } else if (message.includes('5') && message.includes('error') && message.includes('overloaded')) {
        friendlyMsg = 'Server is overloaded. Please try again later.';
      }
      this.sendMessage({ type: 'errorMessage', message: friendlyMsg });
      this.sendMessage({ type: 'statusUpdate', status: 'error', message: 'Error', sessionId });
    }
  }

  interrupt(): void {
    if (this.engine) {
      this.engine.interrupt();
      this.provider?.abort();
    }
  }

  async createSession(): Promise<void> {
    const session = this.sessionManager.create({
      cwd: this.cwd,
      model: this.model,
      provider: this.providerName,
      title: 'VS Code Session',
    });
    this.sessionId = session.id;
    this.engine = null; // Reset engine for new session
    this.bridgeState = createBridgeState(this.sessionId);
    this.bridgeState.model = this.model;
    this.sendMessage({ type: 'sessionHistory', messages: [], sessionId: this.sessionId });
    this.sendMessage({
      type: 'sessionSwitched',
      sessionId: this.sessionId,
      title: session.title || 'Untitled',
    });
  }

  async resumeSession(sessionId: string): Promise<void> {
    const session = this.sessionManager.get(sessionId);
    if (session) {
      this.sessionId = sessionId;
      this.engine = null; // Recreate engine for new session
      this.bridgeState = createBridgeState(this.sessionId);
      this.bridgeState.model = this.model;

      // Send session history — extract readable text from content blocks
      const history = session.messages.map((m) => {
        let text = '';
        if (typeof m.content === 'string') {
          text = m.content;
        } else if (Array.isArray(m.content)) {
          text = m.content
            .filter((b: { type: string; text?: string }) => b.type === 'text')
            .map((b: { type: string; text?: string }) => b.text ?? '')
            .join('\n');
        }
        return { role: m.role as 'assistant' | 'user' | 'system', text };
      }).filter((m) => m.text.length > 0);
      this.sendMessage({ type: 'sessionHistory', messages: history, sessionId: this.sessionId });
      this.sendMessage({
        type: 'sessionSwitched',
        sessionId: this.sessionId,
        title: session.title || 'Untitled',
      });
      this.sendMessage({ type: 'statusUpdate', status: 'ready', message: 'Session resumed', sessionId: this.sessionId });
    }
  }

  listSessions(): Array<{ id: string; title: string; turnCount: number; model: string; createdAt: number }> {
    return this.sessionManager.list().map((s) => ({
      id: s.id,
      title: s.title || 'Untitled',
      turnCount: s.turnCount || 0,
      model: s.model || '',
      createdAt: s.createdAt instanceof Date ? s.createdAt.getTime() : Date.now(),
    }));
  }

  handleApproval(requestId: string, allowed: boolean): void {
    if (!this.bridgeState) return;

    const idx = this.bridgeState.pendingApprovals.findIndex((a) => a.toolUseId === requestId);
    if (idx === -1) return;

    const approval = this.bridgeState.pendingApprovals[idx]!;
    this.bridgeState.pendingApprovals.splice(idx, 1);
    approval.deferred.resolve(allowed);
  }

  dispose(): void {
    this.provider?.abort();
    this.engine = null;
    this.bridgeState = null;
  }

  // ── Private ──────────────────────────────────────────────────────

  private createEngine(): void {
    const engine = new QueryEngine({
      cwd: this.cwd,
      toolRegistry: this.toolRegistry,
      sessionManager: this.sessionManager,
      maxTurns: 100,
      contextBudget: 180_000,
      compactThreshold: 0.7,
      model: this.model,
      provider: this.provider ?? undefined,
      providerModel: this.model,
    });

    this.engine = engine;
    this.bridgeState = createBridgeState(this.sessionId);
    this.bridgeState.model = this.model;
  }
}
