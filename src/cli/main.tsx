#!/usr/bin/env node
/**
 * CoderAgent — CLI Entry Point
 *
 * Bootstraps the three-layer architecture:
 *   core/  — QueryEngine (agent loop)
 *   tui/   — Ink rendering
 *   tools/ — Tool plugins
 *
 * Supports CLI flags:
 *   --help, -h           Show help
 *   --version, -V        Print version
 *   --model, -m [name]   Interactive model selection (or set model non-interactively)
 *   --setup              First-time setup wizard
 *   --print, -p <query>  One-shot query, prints result to stdout and exits
 */

import { render } from 'ink';

import { App } from '../tui/components/App.js';
import { loadConfig, loadSettings, getMaxToolConcurrency } from './config.js';
import { createClient } from '../api/client.js';
import { createCallModelFromClient } from '../core/provider-adapter.js';
import { ToolRegistry } from '../core/tool-registry.js';
import { SessionManager } from '../core/session.js';
import { QueryEngine } from '../core/query-engine.js';
import { SubAgentRegistry } from '../core/subagent-registry.js';
import { SystemPromptAssembler } from '../core/system-prompt.js';
import { plugins } from '../tools/registry.js';
import { RiskLevel, PermissionMode } from '../core/types.js';
import type { ToolDefinition, ToolContext, ToolExecutionResult, QueryMessage, StreamEvent } from '../core/types.js';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface CliArgs {
  help: boolean;
  version: boolean;
  model?: string;
  setup: boolean;
  print?: string;
  /** Positional argument (query text without a flag) */
  query?: string;
}

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = { help: false, version: false, setup: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--version':
      case '-V':
        args.version = true;
        break;
      case '--model':
      case '-m':
        args.model = argv[i + 1];
        if (args.model && !args.model.startsWith('-')) i++;
        else args.model = ''; // interactive mode
        break;
      case '--setup':
      case 'setup':
        args.setup = true;
        break;
      case '--print':
      case '-p':
        args.print = argv[i + 1] ?? '';
        if (args.print) i++;
        break;
      default:
        if (!arg.startsWith('-') && !args.query) {
          positional.push(arg);
        }
        break;
    }
  }
  if (positional.length > 0) args.query = positional.join(' ');
  return args;
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

function buildToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  for (const plugin of plugins) {
    const inputSchema = (plugin.schema as unknown as Record<string, unknown>).input_schema as Record<string, unknown>;
    const meta = (plugin.schema as unknown as Record<string, unknown>)._meta as { riskLevel?: string; isConcurrencySafe?: boolean } | undefined;

    const riskLevelStr = meta?.riskLevel as string | undefined;
    const riskLevel: RiskLevel | undefined =
      riskLevelStr === 'safe' ? RiskLevel.SAFE :
      riskLevelStr === 'destructive' ? RiskLevel.DESTRUCTIVE :
      riskLevelStr === 'mutation' ? RiskLevel.MUTATION :
      RiskLevel.MUTATION;

    const definition: ToolDefinition = {
      name: plugin.name,
      description: plugin.schema.description ?? plugin.name,
      input_schema: inputSchema,
      riskLevel,
      isConcurrencySafe: meta?.isConcurrencySafe ?? false,
    };

    registry.register(definition, async (
      input: Record<string, unknown>,
      context: ToolContext,
    ): Promise<ToolExecutionResult> => {
      try {
        const result = await plugin.executor(input, {
          cwd: context.cwd ?? process.cwd(),
          allowMutation: true,
          maxOutput: 50_000,
          bashTimeout: context.timeoutMs ?? 30_000,
          agentSpawn: context.agentSpawn,
        });
        return { content: result.content, isError: result.isError, duration: result.duration, metadata: result.metadata };
      } catch (err) {
        return { content: `Tool error: ${(err as Error).message}`, isError: true };
      }
    });
  }

  return registry;
}

// ---------------------------------------------------------------------------
// One-shot print mode
// ---------------------------------------------------------------------------

async function runPrintMode(queryText: string): Promise<void> {
  // Load config
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    process.stderr.write(`❌ Configuration error: ${(err as Error).message}\n`);
    process.exit(1);
  }

  // Create engine
  const client = createClient(config);
  const callModel = createCallModelFromClient(client, config.model);
  const toolRegistry = buildToolRegistry();
  const sessionManager = new SessionManager();
  sessionManager.create({ cwd: process.cwd(), model: config.model });

  const settings = loadSettings();
  const subAgentRegistry = new SubAgentRegistry();
  const systemPromptAssembler = new SystemPromptAssembler();

  const engine = new QueryEngine({
    cwd: process.cwd(),
    toolRegistry,
    sessionManager,
    callModel,
    model: config.model,
    maxToolConcurrency: getMaxToolConcurrency(settings),
    subAgentRegistry,
    systemPromptAssembler,
  });

  await engine.init();

  // Print mode has no TUI to show approval prompts — run in AUTO.
  engine.setPermissionMode(PermissionMode.AUTO);

  let fullText = '';

  for await (const event of engine.submitMessage(queryText)) {
    switch (event.type) {
      case 'message': {
        const msg = event.data as QueryMessage;
        if (msg.type === 'stream_event') {
          const streamEvent = msg.event as StreamEvent;
          if (streamEvent.type === 'content_block_delta') {
            const delta = streamEvent.delta;
            if (delta.type === 'text_delta') {
              fullText += delta.text;
              process.stdout.write(delta.text);
            }
          }
        } else if (msg.type === 'assistant') {
          const blocks = msg.message.content as unknown as Array<{ type: string; text?: string; content?: string }> | undefined;
          if (blocks) {
            for (const block of blocks) {
              if (block.type === 'text') {
                const text = block.text ?? block.content ?? '';
                if (!fullText.includes(text)) {
                  fullText += text;
                  process.stdout.write(text);
                }
              }
            }
          }
        }
        break;
      }
      case 'error': {
        const errData = event.data as { message?: string };
        process.stderr.write(`\n❌ ${errData?.message ?? 'Unknown error'}\n`);
        process.exit(1);
      }
      case 'done':
        break;
    }
  }

  if (fullText) process.stdout.write('\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const cliArgs = parseCliArgs(process.argv.slice(2));

  // --help
  if (cliArgs.help) {
    console.log(`Usage: coder [options] [query]

Options:
  --help, -h            Show this help message and exit
  --version, -V         Print version information and exit
  --model, -m [name]    Interactive model selection, or set model directly
                        (e.g. -m "deepseek/deepseek-v4-pro")
  --setup               Launch interactive first-time setup wizard
  --print, -p <query>   One-shot query — prints result and exits
                        (e.g. -p "Explain this file")

Examples:
  coder                                    Start interactive session
  coder "Explain src/core/query.ts"        One-shot query (positional)
  coder -p "Refactor the login function"   One-shot query (explicit)
  coder --model                            Interactive model picker
  coder -m "deepseek/deepseek-v4-pro"      Switch model
  coder setup                              First-time setup wizard
`);
    process.exit(0);
  }

  // --version
  if (cliArgs.version) {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
    console.log(`coder-agent ${pkg.version}`);
    console.log(`node ${process.version}`);
    console.log(`${process.platform} ${process.arch}`);
    process.exit(0);
  }

  // --model (interactive model selection — exits after completion)
  if (cliArgs.model !== undefined || process.argv.includes('--model') || process.argv.includes('-m')) {
    const { handleModelFlag } = await import('./model-picker.js');
    const keepAlive = setInterval(() => {}, 60000);
    try {
      await handleModelFlag(cliArgs.model || undefined);
    } finally {
      clearInterval(keepAlive);
    }
    return;
  }

  // --setup / setup (first-time setup wizard — falls through to TUI)
  if (cliArgs.setup || process.argv.includes('setup') || process.argv.includes('--setup')) {
    const { handleSetupFlag } = await import('./model-picker.js');
    const keepAlive = setInterval(() => {}, 60000);
    try {
      await handleSetupFlag();
    } finally {
      clearInterval(keepAlive);
    }
    // Falls through to TUI
  }

  // --print / -p (one-shot print mode)
  const printQuery = cliArgs.print ?? cliArgs.query;
  if (printQuery) {
    await runPrintMode(printQuery);
    return;
  }

  // ── Interactive TUI mode ──────────────────────────────────────
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    process.stderr.write(
      `❌ Configuration error: ${(err as Error).message}\n`,
    );
    process.exit(1);
  }

  const client = createClient(config);
  const callModel = createCallModelFromClient(client, config.model);
  const toolRegistry = buildToolRegistry();
  const sessionManager = new SessionManager();
  sessionManager.create({ cwd: process.cwd(), model: config.model });

  const settings = loadSettings();
  const subAgentRegistryTui = new SubAgentRegistry();
  const systemPromptAssemblerTui = new SystemPromptAssembler();

  const engine = new QueryEngine({
    cwd: process.cwd(),
    toolRegistry,
    sessionManager,
    callModel,
    model: config.model,
    maxToolConcurrency: getMaxToolConcurrency(settings),
    subAgentRegistry: subAgentRegistryTui,
    systemPromptAssembler: systemPromptAssemblerTui,
  });

  await engine.init();

  const { waitUntilExit } = render(<App config={config} engine={engine} />, {
    exitOnCtrlC: true,
    patchConsole: true,
  });

  await waitUntilExit();
}

main().catch((err) => {
  process.stderr.write(`❌ Runtime error: ${(err as Error).message}\n`);
  process.exit(1);
});
