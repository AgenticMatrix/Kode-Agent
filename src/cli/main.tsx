#!/usr/bin/env node
/**
 * CoderAgent — CLI Entry Point
 *
 * Flags: --help, --version, --model, --setup, --print, --gateway
 * Dynamic imports keep TUI deps (react/ink) out of gateway/print modes.
 */

import { loadConfig, loadSettings, getMaxToolConcurrency } from './config.js';
import type { ToolDefinition, ToolContext, ToolExecutionResult, QueryMessage, StreamEvent } from '../core/types.js';

// ── CLI args ──────────────────────────────────────────────────────────

interface CliArgs { help: boolean; version: boolean; model?: string; setup: boolean; print?: string; query?: string; gateway: boolean; }

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = { help: false, version: false, setup: false, gateway: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--help': case '-h': args.help = true; break;
      case '--version': case '-V': args.version = true; break;
      case '--model': case '-m': args.model = argv[i + 1]; if (args.model && !args.model.startsWith('-')) i++; else args.model = ''; break;
      case '--setup': case 'setup': args.setup = true; break;
      case '--gateway': case '-g': args.gateway = true; break;
      case '--print': case '-p': args.print = argv[i + 1] ?? ''; if (args.print) i++; break;
      default: if (!arg.startsWith('-') && !args.query) positional.push(arg); break;
    }
  }
  if (positional.length > 0) args.query = positional.join(' ');
  return args;
}

// ── Tool registry (shared) ──────────────────────────────────────────

async function buildToolRegistry(): Promise<any> {
  const { ToolRegistry } = await import('../core/tool-registry.js');
  const { plugins } = await import('../tools/registry.js');
  const { RiskLevel } = await import('../core/types.js');
  const registry = new ToolRegistry();
  for (const plugin of plugins) {
    const schema = plugin.schema as unknown as Record<string, unknown>;
    const inputSchema = schema.input_schema as Record<string, unknown>;
    const meta = schema._meta as { riskLevel?: string; isConcurrencySafe?: boolean } | undefined;
    const riskLevel = meta?.riskLevel === 'safe' ? RiskLevel.SAFE : meta?.riskLevel === 'destructive' ? RiskLevel.DESTRUCTIVE : RiskLevel.MUTATION;
    registry.register({ name: plugin.name, description: (schema.description as string) ?? plugin.name, input_schema: inputSchema, riskLevel, isConcurrencySafe: meta?.isConcurrencySafe ?? false },
      async (input: Record<string, unknown>, ctx: any) => {
        try { const r = await plugin.executor(input, { cwd: ctx.cwd ?? process.cwd(), allowMutation: true, maxOutput: 50_000, bashTimeout: ctx.timeoutMs ?? 30_000, agentSpawn: ctx.agentSpawn }); return { content: r.content, isError: r.isError, duration: r.duration, metadata: r.metadata }; }
        catch (err) { return { content: `Tool error: ${(err as Error).message}`, isError: true }; }
      });
  }
  return registry;
}

// ── Print mode ──────────────────────────────────────────────────────

async function runPrintMode(queryText: string): Promise<void> {
  let config; try { config = loadConfig(); } catch (err) { process.stderr.write(`Config error: ${(err as Error).message}\n`); process.exit(1); }
  const { createClient } = await import('../api/client.js');
  const { createCallModelFromClient } = await import('../core/provider-adapter.js');
  const client = createClient(config); const callModel = createCallModelFromClient(client, config.model);
  const { SessionManager } = await import('../core/session.js');
  const sm = new SessionManager(); sm.create({ cwd: process.cwd(), model: config.model });
  const { setTaskListId } = await import('../tasks/store.js');
  setTaskListId(sm.getActive().id);
  const { SubAgentRegistry } = await import('../core/subagent-registry.js');
  const { SystemPromptAssembler } = await import('../core/system-prompt.js');
  const { QueryEngine } = await import('../core/query-engine.js');
  const { PermissionMode } = await import('../core/types.js');
  const { buildAgentRegistry } = await import('../agents/registry.js');
  const { registry: agentRegistry } = await buildAgentRegistry(process.cwd());
  const settings = loadSettings();
  const engine = new QueryEngine({ cwd: process.cwd(), toolRegistry: await buildToolRegistry(), sessionManager: sm, callModel, model: config.model, maxToolConcurrency: getMaxToolConcurrency(settings), subAgentRegistry: new SubAgentRegistry(), systemPromptAssembler: new SystemPromptAssembler(), agentRegistry, settings });
  await engine.init(); engine.setPermissionMode(PermissionMode.AUTO);
  let fullText = '';
  for await (const event of engine.submitMessage(queryText)) {
    if (event.type === 'message') {
      const msg = event.data as QueryMessage;
      if (msg.type === 'stream_event') { const se = msg.event as StreamEvent; if (se.type === 'content_block_delta' && se.delta?.type === 'text_delta') { fullText += se.delta.text!; process.stdout.write(se.delta.text!); } }
      else if (msg.type === 'assistant') { const blocks = msg.message?.content as any; if (blocks) for (const b of blocks) { if (b.type === 'text') { const t = b.text ?? b.content ?? ''; if (!fullText.includes(t)) { fullText += t; process.stdout.write(t); } } } }
    } else if (event.type === 'error') { process.stderr.write(`\n${(event.data as any)?.message ?? 'Error'}\n`); process.exit(1); }
  }
  if (fullText) process.stdout.write('\n'); process.exit(0);
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cliArgs = parseCliArgs(process.argv.slice(2));

  if (cliArgs.help) { console.log(`Usage: coder [options] [query]\n\nOptions:\n  --help, -h            Show help\n  --version, -V         Print version\n  --model, -m [name]    Select model\n  --setup               Setup wizard\n  --print, -p <query>   One-shot query\n  --gateway, -g         JSON-RPC gateway mode\n`); process.exit(0); }

  if (cliArgs.version) { const { readFileSync } = await import('node:fs'); const { join, dirname } = await import('node:path'); const { fileURLToPath } = await import('node:url'); const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf-8')) as { version: string }; console.log(`coder-agent ${pkg.version}\nnode ${process.version}\n${process.platform} ${process.arch}`); process.exit(0); }

  if (cliArgs.model !== undefined || process.argv.includes('--model') || process.argv.includes('-m')) {
    const { handleModelFlag } = await import('./model-picker.js');
    const keep = setInterval(() => {}, 60000);
    try { await handleModelFlag(cliArgs.model || undefined); } finally { clearInterval(keep); }
    return;
  }

  if (cliArgs.setup || process.argv.includes('setup') || process.argv.includes('--setup')) {
    const { handleSetupFlag } = await import('./model-picker.js');
    const keep = setInterval(() => {}, 60000);
    try { await handleSetupFlag(); } finally { clearInterval(keep); }
  }

  const printQuery = cliArgs.print ?? cliArgs.query;
  if (printQuery) { await runPrintMode(printQuery); return; }

  // ── Gateway mode ──────────────────────────────────────────────
  if (cliArgs.gateway) { const { startGateway } = await import('../gateway/server.js'); await startGateway(); return; }

  // ── TUI mode ──────────────────────────────────────────────────
  let config; try { config = loadConfig(); } catch (err) { process.stderr.write(`Config error: ${(err as Error).message}\n`); process.exit(1); }
  const { createClient } = await import('../api/client.js');
  const { createCallModelFromClient } = await import('../core/provider-adapter.js');
  const client = createClient(config); const callModel = createCallModelFromClient(client, config.model);
  const { SessionManager } = await import('../core/session.js');
  const sm = new SessionManager(); sm.create({ cwd: process.cwd(), model: config.model });
  const { setTaskListId } = await import('../tasks/store.js');
  setTaskListId(sm.getActive().id);
  const { SubAgentRegistry } = await import('../core/subagent-registry.js');
  const { SystemPromptAssembler } = await import('../core/system-prompt.js');
  const { QueryEngine } = await import('../core/query-engine.js');
  const { buildAgentRegistry: buildAgentReg } = await import('../agents/registry.js');
  const subAgentRegistry = new SubAgentRegistry();
  const { setSubAgentRegistry } = await import('../agents/agent-spawn/registry-ref.js');
  setSubAgentRegistry(subAgentRegistry);
  const { registry: agentRegistry } = await buildAgentReg(process.cwd());
  const settings = loadSettings();
  const engine = new QueryEngine({ cwd: process.cwd(), toolRegistry: await buildToolRegistry(), sessionManager: sm, callModel, model: config.model, maxToolConcurrency: getMaxToolConcurrency(settings), subAgentRegistry, systemPromptAssembler: new SystemPromptAssembler(), agentRegistry, settings });
  await engine.init();

  const { render } = await import('ink');
  const { App } = await import('../tui/components/App.js');
  const { waitUntilExit } = render(<App config={config} engine={engine} />, { exitOnCtrlC: false, patchConsole: true });
  await waitUntilExit();
}

main().catch((err) => { process.stderr.write(`Error: ${(err as Error).message}\n`); process.exit(1); });
