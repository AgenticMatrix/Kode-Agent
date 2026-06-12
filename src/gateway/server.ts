/**
 * server.ts — JSON-RPC Gateway Server
 *
 * Launched via `coder --gateway`. Reads JSON-RPC requests from stdin,
 * manages a QueryEngine, and writes raw events/responses to stdout.
 * Protocol: newline-delimited JSON (one JSON object per line)
 *
 * The VS Code extension handles bridge-to-webview translation client-side.
 */

import { createInterface } from 'node:readline';
import { loadConfig, loadSettings, getMaxToolConcurrency } from '../cli/config.js';
import { createClient } from '../api/client.js';
import { createCallModelFromClient } from '../core/provider-adapter.js';
import { ToolRegistry } from '../core/tool-registry.js';
import { SessionManager } from '../core/session.js';
import { QueryEngine } from '../core/query-engine.js';
import { SubAgentRegistry } from '../core/subagent-registry.js';
import { SystemPromptAssembler } from '../core/system-prompt.js';
import { plugins } from '../tools/registry.js';
import { PermissionMode, RiskLevel } from '../core/types.js';
import type { ToolDefinition, ToolContext, ToolExecutionResult, DeferredPermission, AssistantMessage, ContentBlock, CompletionUsage, QueryMessage } from '../core/types.js';

// ── JSON-RPC ────────────────────────────────────────────────────────

interface RpcRequest { id: number | string; method: string; params?: Record<string, unknown>; }
interface RpcResponse { id: number | string; result?: unknown; error?: { code: number; message: string }; }

function respond(id: number | string, result?: unknown, error?: { code: number; message: string }): void {
  process.stdout.write(JSON.stringify({ id, ...(error ? { error } : { result }) }) + '\n');
}

function notify(ev: unknown): void {
  process.stdout.write(JSON.stringify({ type: 'event', event: ev }) + '\n');
}

// ── Tool registry ───────────────────────────────────────────────────

function buildToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const plugin of plugins) {
    const schema = plugin.schema as unknown as Record<string, unknown>;
    const inputSchema = schema.input_schema as Record<string, unknown>;
    const meta = schema._meta as { riskLevel?: string; isConcurrencySafe?: boolean } | undefined;
    const riskLevel =
      meta?.riskLevel === 'safe' ? RiskLevel.SAFE :
      meta?.riskLevel === 'destructive' ? RiskLevel.DESTRUCTIVE :
      RiskLevel.MUTATION;
    registry.register({
      name: plugin.name, description: (schema.description as string) ?? plugin.name,
      input_schema: inputSchema, riskLevel, isConcurrencySafe: meta?.isConcurrencySafe ?? false,
    }, async (input: Record<string, unknown>, ctx: any) => {
      try {
        const r = await plugin.executor(input, { cwd: ctx.cwd ?? process.cwd(), allowMutation: true, maxOutput: 50_000, bashTimeout: ctx.timeoutMs ?? 30_000, agentSpawn: ctx.agentSpawn });
        return { content: r.content, isError: r.isError, duration: r.duration, metadata: r.metadata };
      } catch (err) { return { content: `Tool error: ${(err as Error).message}`, isError: true }; }
    });
  }
  return registry;
}

// ── Event conversion (minimal — extension-side bridge handles full translation) ──

// Track pre-fill permission data for when permission_required event arrives
let pendingDeferred: DeferredPermission | null = null;

function convertMessageEvent(msg: QueryMessage, sessionId: string): unknown[] {
  const events: unknown[] = [];
  const sid = sessionId;

  if (msg.type === 'stream_event' && msg.event) {
    const ev = msg.event;
    switch (ev.type) {
      case 'message_start':
        events.push({ type: 'message.start', session_id: sid });
        break;
      case 'content_block_delta': {
        const d = ev.delta!;
        if (d.type === 'text_delta') events.push({ type: 'message.delta', payload: { text: d.text }, session_id: sid });
        break;
      }
      case 'content_block_start': {
        const b = ev.content_block!;
        if (b.type === 'tool_use' && b.id && b.name) {
          events.push({ type: 'tool.start', payload: { tool_id: b.id, name: b.name, args_text: b.input ? JSON.stringify(b.input) : undefined }, session_id: sid });
        }
        break;
      }
      case 'content_block_stop': break;
      case 'message_delta':
      case 'message_stop': break;
    }
  } else if (msg.type === 'assistant') {
    const am = msg.message as AssistantMessage;
    const text = extractText(am);
    const toolNames = am.toolUseBlocks?.map((b: any) => b.name) ?? [];
    events.push({
      type: 'message.complete',
      payload: {
        text,
        usage: {
          calls: 1, input: am.usage?.input_tokens ?? 0, output: am.usage?.output_tokens ?? 0,
          total: (am.usage?.input_tokens ?? 0) + (am.usage?.output_tokens ?? 0),
          cost_usd: am.usage?.totalCost,
        },
      },
      session_id: sid,
    });
    if (toolNames.length > 0) {
      events.push({ type: 'status.update', payload: { text: `Used ${toolNames.length} tool(s): ${toolNames.join(', ')}` }, session_id: sid });
    }
  } else if (msg.type === 'system') {
    if (msg.subtype === 'progress') {
      const p = msg.data as any;
      if (p?.status === 'completed') {
        events.push({ type: 'tool.complete', payload: { tool_id: p.toolUseId, name: p.toolName, duration_s: 0 }, session_id: sid });
      }
    } else if (msg.subtype === 'permission_required') {
      const d = msg.deferred as DeferredPermission | undefined;
      if (d) {
        pendingDeferred = d;
        events.push({
          type: 'approval.request',
          payload: { command: d.toolName, description: d.description || d.toolName, request_id: d.toolUseId, tool_use_id: d.toolUseId },
          session_id: sid,
        });
      }
    }
  }
  return events;
}

function extractText(msg: AssistantMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) return msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text ?? '').join('\n');
  return '';
}

// ── Main server loop ────────────────────────────────────────────────

export async function startGateway(): Promise<void> {
  let config: ReturnType<typeof loadConfig>;
  try { config = loadConfig(); } catch (err) { process.stderr.write(`Config error: ${(err as Error).message}\n`); process.exit(1); }

  const client = createClient(config);
  const callModel = createCallModelFromClient(client, config.model);
  const toolRegistry = buildToolRegistry();
  const sessionManager = new SessionManager();
  sessionManager.create({ cwd: process.cwd(), model: config.model });

  const settings = loadSettings();
  const subAgentRegistry = new SubAgentRegistry();
  const { setSubAgentRegistry } = await import('../agents/agent-spawn/registry-ref.js');
  setSubAgentRegistry(subAgentRegistry);
  const systemPromptAssembler = new SystemPromptAssembler();
  const { buildAgentRegistry } = await import('../agents/registry.js');
  const { registry: agentRegistry } = await buildAgentRegistry(process.cwd());

  const engine = new QueryEngine({ cwd: process.cwd(), toolRegistry, sessionManager, callModel, model: config.model, maxToolConcurrency: getMaxToolConcurrency(settings), subAgentRegistry, systemPromptAssembler, agentRegistry });

  let currentSessionId = sessionManager.list()[0]?.id ?? '';
  let ready = false;
  let engineInstance = engine;


  // Set up readline BEFORE engine init so stdin is never lost
  const rl = createInterface({ input: process.stdin });
  let buffer = '';
  const pendingQueue: (() => Promise<void>)[] = [];

  rl.on('line', async (line: string) => {
    buffer += line;
    try {
      const req: RpcRequest = JSON.parse(buffer);
      buffer = '';
      await handle(req);
    } catch { /* Partial JSON */ }
  });

  async function handle(req: RpcRequest): Promise<void> {
    if (!ready && req.method !== 'gateway.status' && req.method !== 'session.create' && req.method !== 'session.list') {
      // Queue non-status requests until engine is ready
      await new Promise<void>((resolve) => {
        pendingQueue.push(async () => { await processRequest(req); resolve(); });
      });
      return;
    }
    await processRequest(req);
  }

  async function processRequest(req: RpcRequest): Promise<void> {
    switch (req.method) {
      case 'prompt.submit': {
        const text = (req.params?.text as string) ?? '';
        // Auto-title from first message
        const s = sessionManager.get(currentSessionId);
        if (s && (s.title.startsWith('Session ') || s.title === 'Untitled')) {
          s.title = text.length > 50 ? text.slice(0, 50) + '...' : text;
          sessionManager.saveSession(s);
        }
        notify({ type: 'message.start', session_id: currentSessionId });

        for await (const ev of engineInstance.submitMessage(text)) {
          switch (ev.type) {
            case 'message': {
              const events = convertMessageEvent(ev.data as QueryMessage, currentSessionId);
              for (const e of events) notify(e);
              break;
            }
            case 'error':
              notify({ type: 'status.update', payload: { text: `Error: ${(ev.data as any)?.message ?? ''}`, kind: 'error' }, session_id: currentSessionId });
              break;
          }
        }

        notify({ type: 'status.update', payload: { text: 'Ready' }, session_id: currentSessionId });
        respond(req.id, { ok: true });
        break;
      }

      case 'approval.respond': {
        const requestId = (req.params?.request_id as string) ?? '';
        const allowed = (req.params?.allowed as boolean) ?? false;
        if (pendingDeferred && pendingDeferred.toolUseId === requestId) {
          pendingDeferred.resolve(allowed);
          pendingDeferred = null;
        }
        respond(req.id, { ok: true });
        break;
      }

      case 'session.list': {
        const sessions = sessionManager.list().map((s: any) => ({ id: s.id, title: s.title || 'Untitled', turnCount: s.turnCount || 0, model: s.model || '', createdAt: s.createdAt instanceof Date ? s.createdAt.getTime() : Date.now() }));
        respond(req.id, { sessions });
        break;
      }

      case 'session.create': {
        const s = sessionManager.create({ cwd: process.cwd(), model: config.model });
        currentSessionId = s.id;
        respond(req.id, { sessionId: s.id, title: s.title || 'Untitled' });
        break;
      }

      case 'session.resume': {
        const id = (req.params?.session_id as string) ?? '';
        const s = sessionManager.get(id);
        if (s) {
          currentSessionId = id;
          const messages = s.messages.map((m: any) => {
            let text = ''; if (typeof m.content === 'string') text = m.content; else if (Array.isArray(m.content)) text = m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text ?? '').join('\n');
            return { role: m.role, text };
          }).filter((m: any) => m.text.length > 0);
          respond(req.id, { sessionId: id, title: s.title || 'Untitled', messages });
        } else respond(req.id, undefined, { code: 404, message: 'Not found' });
        break;
      }

      case 'interrupt': { engineInstance.interrupt(); respond(req.id, { ok: true }); break; }
      case 'gateway.status': { respond(req.id, { model: config.model, provider: (config as any).providerName, sessionId: currentSessionId }); break; }
      default: respond(req.id, undefined, { code: -32601, message: `Unknown method: ${req.method}` });
    }
  }

  // Tell client we're alive BEFORE init (init is fast, but tsx compilation adds delay)
  notify({ type: 'gateway.ready', payload: { model: config.model }, session_id: currentSessionId });

  await engine.init();
  engine.setPermissionMode(PermissionMode.ASK);
  ready = true;
  for (const fn of pendingQueue) await fn();
  pendingQueue.length = 0;
  setInterval(() => {}, 10000).unref();
}
