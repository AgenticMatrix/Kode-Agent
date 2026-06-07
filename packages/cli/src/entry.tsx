#!/usr/bin/env -S node --max-old-space-size=8192 --expose-gc
// Must be first import. If the user explicitly opts into truecolor, this
// nudges chalk / supports-color before either package is initialized.
import './lib/forceTruecolor.js'
import React from 'react'

import type { FrameEvent } from '@coder/tui'

import { CoderGatewayClient } from './gateway/coder-client.js'
import { setupGracefulExit } from './lib/gracefulExit.js'
import { openExternalUrl } from './lib/openExternalUrl.js'
import { resetTerminalModes } from './lib/terminalModes.js'

// ---------------------------------------------------------------------------
// CLI args — Coordinator / Worker mode + Model / Provider
// ---------------------------------------------------------------------------

interface CliArgs {
  help: boolean
  /** Print version information and exit */
  version: boolean
  coordinator: boolean
  team?: string
  workers: number
  worker: boolean
  /** Print last session summary and exit */
  print?: boolean
  /** Resume a specific session by ID */
  resume?: string
  /** Continue the most recently updated session */
  continueLatest?: boolean
  /** Fork from a specific session ID */
  forkSession?: string
  /** Turn number to fork from (used with --fork-session) */
  forkTurn?: number
  /** Enable extended thinking mode */
  thinking?: boolean
  /** Extended thinking budget in tokens */
  thinkingBudget?: number
  /** Model name (e.g. "deepseek-v4-pro", "gpt-4o", "claude-sonnet-4-6") */
  model?: string
  /** Provider name (e.g. "anthropic", "openai", "deepseek", "auto") */
  provider?: string
  /** Append to system prompt (added after base instructions) */
  systemPrompt?: string
  /** Launch interactive first-time setup wizard */
  setup?: boolean
}

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = { help: false, version: false, coordinator: false, workers: 3, worker: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    switch (arg) {
      case '--version':
      case '-V':
        args.version = true
        break
      case '--help':
      case '-h':
        args.help = true
        break
      case '--coordinator':
      case '-C':
        args.coordinator = true
        break
      case '--team':
      case '-T':
        args.team = argv[i + 1] ?? undefined
        if (args.team && !args.team.startsWith('-')) i++
        else args.team = undefined
        break
      case '--workers':
      case '-W':
        args.workers = parseInt(argv[i + 1] ?? '3', 10) || 3
        i++
        break
      case '--worker':
        args.worker = true
        break
      case '--print':
        args.print = true
        break
      case '--resume':
        args.resume = argv[i + 1] ?? undefined
        if (args.resume && !args.resume.startsWith('-')) i++
        else args.resume = undefined
        break
      case '--continue':
        args.continueLatest = true
        break
      case '--fork-session':
        args.forkSession = argv[i + 1] ?? undefined
        if (args.forkSession && !args.forkSession.startsWith('-')) i++
        else args.forkSession = undefined
        break
      case '--fork-turn':
        args.forkTurn = parseInt(argv[i + 1] ?? '0', 10) || 0
        i++
        break
      case '--thinking':
        args.thinking = true
        break
      case '--thinking-budget':
        args.thinkingBudget = parseInt(argv[i + 1] ?? '1024', 10) || 1024
        i++
        break
      case '--model':
      case '-m':
        args.model = argv[i + 1]
        i++
        break
      case '--provider':
      case '-p':
        args.provider = argv[i + 1]
        i++
        break
      case '--system-prompt':
        args.systemPrompt = argv[i + 1]
        i++
        break
      case 'setup':
      case '--setup':
        args.setup = true
        break
      default:
        break
    }
  }
  return args
}

const cliArgs = parseCliArgs(process.argv.slice(2))

// Sync CLI args to env vars so child processes and engine-factory can read them
if (cliArgs.coordinator) {
  process.env.CODER_COORDINATOR_MODE = 'true'
}
if (cliArgs.team) {
  process.env.CODER_TEAM_ID = cliArgs.team
}
if (cliArgs.worker) {
  process.env.CODER_WORKER_MODE = 'true'
}
if (cliArgs.thinking) {
  process.env.CODER_THINKING_MODE = 'true'
}
if (cliArgs.thinkingBudget != null) {
  process.env.CODER_THINKING_BUDGET = String(cliArgs.thinkingBudget)
}
if (cliArgs.model) {
  process.env.CODER_MODEL = cliArgs.model
}
if (cliArgs.provider) {
  process.env.CODER_PROVIDER = cliArgs.provider
}
if (cliArgs.systemPrompt) {
  process.env.CODER_APPEND_SYSTEM_PROMPT = cliArgs.systemPrompt
}

// --help: print usage and exit (non-TUI mode)
if (cliArgs.help) {
  console.log(`Usage: coder [options]

Options:
  --help, -h            Show this help message and exit
  --version, -V         Print version information and exit
  --print               Print last session summary and exit (no TUI required)
  --resume <id>         Resume a specific session by ID
  --continue            Continue the most recently updated session
  --fork-session <id>   Fork from a specific session ID
  --fork-turn <n>       Turn number to fork from (used with --fork-session)
  --coordinator, -C     Start in Coordinator mode (Agent Teams)
  --team, -T <id>       Team identifier for Coordinator ↔ Worker routing
  --workers, -W <n>     Number of workers in Coordinator mode (default: 3)
  --worker              Start in Worker mode
  --model, -m <name>    Model name (e.g. "deepseek-v4-pro", "gpt-4o")
  --provider, -p <name> Provider name: "anthropic" | "openai" | "deepseek" | "auto"
  --thinking            Enable extended thinking mode
  --thinking-budget <n> Extended thinking budget in tokens (default: 1024)
  --system-prompt <text> Append additional system prompt text
  --setup               Launch interactive first-time setup wizard
`);
  process.exit(0);
}

// --print: print last session summary and exit (non-TUI mode)
if (cliArgs.print) {
  const { SessionManager } = await import('@coder/core');
  const sm = new SessionManager();
  const sessions = sm.listSessions(10);
  if (sessions.length === 0) {
    console.log('No sessions found.');
  } else {
    console.log('Recent sessions:');
    for (const s of sessions) {
      console.log(`  ${s.id.slice(0, 8)}  ${s.status.padEnd(10)}  ${s.title.padEnd(40)}  ${s.createdAt}`);
    }
  }
  process.exit(0);
}

// --version: print version info and exit (non-TUI mode, works without terminal)
if (cliArgs.version) {
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '../package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  console.log(`coder-agent ${pkg.version}`);
  console.log(`node ${process.version}`);
  console.log(`${process.platform} ${process.arch}`);
  process.exit(0);
}

// ── radioSelect helper (shared by --model and --setup) ──────────────────────
function radioSelect(
  options: string[],
  activeIndex: number,
  title: string,
  stdin: typeof process.stdin,
  stdout: typeof process.stdout,
): Promise<number> {
  return new Promise((resolve) => {
    if (!stdin.isTTY) {
      console.log(`${title}\n  (non-TTY mode, using default)\n`);
      resolve(activeIndex);
      return;
    }

    let selected = activeIndex;
    let firstRender = true;
    const totalLines = options.length + 2;
    const rawModeWas = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdout.write('\x1B[?25l');

    function render() {
      if (!firstRender) {
        stdout.write(`\x1B[${totalLines}A\r`);
      }
      firstRender = false;

      stdout.write(`\x1B[K${title}\n`);
      options.forEach((opt, i) => {
        const marker = i === selected ? '\x1B[1m●\x1B[0m' : '○';
        stdout.write(`\x1B[K  ${marker} ${opt}\n`);
      });
      stdout.write(`\x1B[K\n\x1B[K  \x1B[2m↑↓ to navigate, Enter to confirm\x1B[0m`);
    }

    render();

    function onData(data: Buffer) {
      const key = data[0];
      if (key === 13) {
        cleanup();
        resolve(selected);
        return;
      }
      if (key === 3) {
        cleanup();
        stdout.write('\n');
        process.exit(0);
      }
      if (key === 27 && data.length >= 3) {
        if (data[1] === 91) {
          if (data[2] === 65) {
            selected = (selected - 1 + options.length) % options.length;
            render();
          } else if (data[2] === 66) {
            selected = (selected + 1) % options.length;
            render();
          }
        }
      }
    }

    function cleanup() {
      stdin.setRawMode(rawModeWas);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\x1B[?25h\n');
    }

    stdin.on('data', onData);
  });
}

// ── Reusable interactive model setup (shared by --model and --setup) ────────
// Returns true if the user completed setup (selected a model), false if they
// skipped (no changes made).
async function runInteractiveModelSetup(
  settings: any,
  modelList: Array<{model: string[]; base_url?: string; auth_token_env?: string; provider: string; proxy?: string | null; price?: any}>,
  settingsPath: string,
  stdin: typeof process.stdin,
  stdout: typeof process.stdout,
  writeFileSync: (path: string, data: string) => void,
): Promise<boolean> {
  const defaultModel = settings.default_model ?? '';
  const defaultProvider = defaultModel ? defaultModel.split('/')[0] : 'deepseek';
  let selectedProvider: any;
  let providerDone = false;
  while (!providerDone) {

  let providerActiveIdx = modelList.findIndex(m => m.provider === defaultProvider);
  if (providerActiveIdx < 0) providerActiveIdx = 0;

  const providerOptions = modelList.map(m => {
    const firstModel = m.model[0] ?? 'unknown';
    const isActive = m.provider === defaultProvider;
    return `${m.provider} (${firstModel}...)${isActive ? '  <- currently active' : ''}`;
  });
  providerOptions.push('Custom new provider');
  providerOptions.push('Remove provider');
  providerOptions.push('Skip');

  const selectedProviderIdx = await radioSelect(
    providerOptions,
    providerActiveIdx,
    'Available providers:',
    stdin,
    stdout,
  );

  if (selectedProviderIdx === modelList.length) {
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const name = await new Promise<string>(resolve => rl.question('Enter provider name (e.g. myprovider): ', resolve));
    const url = await new Promise<string>(resolve => rl.question('Enter base URL (e.g. https://api.example.com/v1): ', resolve));
    const key = await new Promise<string>(resolve => rl.question('Enter API key (or press Enter to skip): ', resolve));
    const proxy = await new Promise<string>(resolve => rl.question('Enter proxy URL (e.g. http://127.0.0.1:7890, or press Enter to skip): ', resolve));
    rl.close();
    selectedProvider = {
      provider: name.trim(),
      model: [],
      base_url: url.trim() || undefined,
      auth_token_env: key.trim() || `YOUR_${name.trim().toUpperCase()}_API_KEY`,
      proxy: proxy.trim() || null,
      price: { input: 0, output: 0, currency: 'USD', unit: '1M tokens' }
    };
    modelList.push(selectedProvider);
    providerDone = true;
  } else if (selectedProviderIdx === modelList.length + 1) {
    const removeProviderOptions = modelList.map(m => m.provider);
    const removeIdx = await radioSelect(
      removeProviderOptions,
      0,
      'Select provider to remove:',
      stdin,
      stdout,
    );
    const targetProvider = modelList[removeIdx]!.provider;
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const confirm = await new Promise<string>(resolve => rl.question(
      `Remove provider "${targetProvider}" from settings? (y/N): `,
      resolve
    ));
    rl.close();
    if (confirm.trim().toLowerCase() === 'y') {
      settings.model_list = (settings.model_list ?? []).filter(
        (m: any) => m.provider !== targetProvider
      );
      if (settings.default_model?.startsWith(targetProvider + '/')) {
        settings.default_model = '';
      }
      const mdlIdx = modelList.findIndex((m: any) => m.provider === targetProvider);
      if (mdlIdx >= 0) modelList.splice(mdlIdx, 1);
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      console.log(`Provider "${targetProvider}" removed. Returning to provider selection...\n`);
      continue;
    } else {
      console.log('Cancelled. Returning to provider selection...\n');
      continue;
    }
  } else if (selectedProviderIdx === modelList.length + 2) {
    // Skip - exit without changes
    console.log('Skipped. No changes made.');
    return false;
  } else {
    selectedProvider = modelList[selectedProviderIdx]!;
    providerDone = true;
  }
  } // end while
  console.log(`Selected provider: ${selectedProvider.provider}\n`);

  // ── Provider config: base_url + api_key + proxy ───────────────────────────
  // URL
  {
    const currentUrl = selectedProvider.base_url ?? '(not set)';
    console.log(`Base URL: ${currentUrl}`);
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const newUrl = await new Promise<string>(resolve => rl.question('Press Enter to keep, or type a new URL: ', resolve));
    rl.close();
    if (newUrl.trim()) {
      selectedProvider.base_url = newUrl.trim();
      console.log('  URL updated.\n');
    } else {
      console.log('  Keeping current URL.\n');
    }
  }
  // API Key
  {
    const currentToken = selectedProvider.auth_token_env ?? '';
    let displayToken: string;
    if (!currentToken) {
      displayToken = '(not set)';
    } else if (currentToken.startsWith('YOUR_') || currentToken === 'LOCAL_NO_KEY') {
      displayToken = currentToken;
    } else if (currentToken.length > 12) {
      displayToken = `${currentToken.slice(0, 6)}******${currentToken.slice(-6)}`;
    } else {
      displayToken = currentToken;
    }
    console.log(`API Key (auth_token_env): ${displayToken}`);
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const newToken = await new Promise<string>(resolve => rl.question('Press Enter to keep, or type a new key: ', resolve));
    rl.close();
    if (newToken.trim()) {
      selectedProvider.auth_token_env = newToken.trim();
      console.log('  Token updated.\n');
    } else {
      console.log('  Keeping current token.\n');
    }
  }
  // Proxy
  {
    const currentProxy = selectedProvider.proxy ?? 'None (no proxy)';
    console.log(`Proxy: ${currentProxy}`);
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const newProxy = await new Promise<string>(resolve => rl.question('Press Enter to keep, or type a proxy URL (or "none" to disable): ', resolve));
    rl.close();
    if (newProxy.trim().toLowerCase() === 'none') {
      selectedProvider.proxy = undefined;
      console.log('  Proxy disabled.\n');
    } else if (newProxy.trim()) {
      selectedProvider.proxy = newProxy.trim();
      console.log('  Proxy updated.\n');
    } else {
      console.log('  Keeping current proxy.\n');
    }
  }

  // ── Step 2: Model selection ───────────────────────────────────────────────
  const currentDefaultModel = defaultModel.split('/')[1] ?? selectedProvider.model[0] ?? '';
  let selectedModel = '';
  let modelDone = false;
  while (!modelDone) {
  let modelActiveIdx = selectedProvider.model.findIndex((m: string) => m === currentDefaultModel);
  if (modelActiveIdx < 0) modelActiveIdx = 0;

  const modelOptions = selectedProvider.model.map((m: string) => {
    const isActive = m === currentDefaultModel;
    return `${m}${isActive ? '  <- currently active' : ''}`;
  });
  modelOptions.push('Custom model name');
  modelOptions.push('Remove model');
  modelOptions.push('Skip');

  const selectedModelIdx = await radioSelect(
    modelOptions,
    modelActiveIdx,
    `Available models for ${selectedProvider.provider}:`,
    stdin,
    stdout,
  );

  if (selectedModelIdx === selectedProvider.model.length) {
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const name = await new Promise<string>(resolve => rl.question('Enter model name (e.g. my-model-v1): ', resolve));
    rl.close();
    const modelName = name.trim();
    selectedProvider.model.push(modelName);
    selectedModel = modelName;
  } else if (selectedModelIdx === selectedProvider.model.length + 1) {
    const removeModelOptions = selectedProvider.model.map((m: string) => m);
    const removeIdx = await radioSelect(
      removeModelOptions,
      0,
      `Select model to remove from ${selectedProvider.provider}:`,
      stdin,
      stdout,
    );
    const modelToRemove = selectedProvider.model[removeIdx]!;
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const confirm = await new Promise<string>(resolve => rl.question(
      `Remove model "${modelToRemove}" from ${selectedProvider.provider}? (y/N): `,
      resolve
    ));
    rl.close();
    if (confirm.trim().toLowerCase() === 'y') {
      selectedProvider.model = selectedProvider.model.filter((m: string) => m !== modelToRemove);
      if (selectedProvider.model.length === 0) {
        console.log(`Model "${modelToRemove}" removed. No models left.\n`);
      } else {
        console.log(`Model "${modelToRemove}" removed.\n`);
      }
      continue;
    } else {
      console.log('Cancelled.\n');
      continue;
    }
  } else if (selectedModelIdx === selectedProvider.model.length + 2) {
    selectedModel = selectedProvider.model[0] ?? '';
    modelDone = true;
    if (!selectedModel) {
      console.log('No model selected. You can configure one later.\n');
    }
  } else {
    selectedModel = selectedProvider.model[selectedModelIdx]!;
    modelDone = true;
  }
  } // end while
  console.log(`Selected model: ${selectedModel}\n`);

  // ── Update settings.json ──────────────────────────────────────────────────
  settings.default_model = `${selectedProvider.provider}/${selectedModel}`;
  settings.env = settings.env ?? {};
  settings.env.CODER_MODEL = selectedModel;
  if (selectedProvider.base_url) settings.env.CODER_BASE_URL = selectedProvider.base_url;
  if (selectedProvider.auth_token_env) settings.env.CODER_AUTH_TOKEN = selectedProvider.auth_token_env;

  settings.model_list = settings.model_list ?? [];
  {
    const existingIdx = settings.model_list.findIndex(
      (m: any) => m.provider === selectedProvider.provider
    );
    if (existingIdx >= 0) {
      settings.model_list[existingIdx] = { ...settings.model_list[existingIdx], ...selectedProvider };
    } else {
      settings.model_list.push(selectedProvider);
    }
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log(`Default model set to: ${selectedProvider.provider}/${selectedModel}`);
  return true;
}

// --model: interactive model selection (non-TUI mode)
if (cliArgs.model || process.argv.includes('--model')) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');

  const settingsPath = join(homedir(), '.coder', 'settings.json');
  let settings: any = {};
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  } catch {}

  const modelList: Array<{model: string[]; base_url?: string; auth_token_env?: string; provider: string; proxy?: string | null}> =
    settings.model_list ?? [];

  if (modelList.length === 0) {
    console.log('No models configured. Add models to ~/.coder/settings.json model_list.');
    process.exit(0);
  }

  const targetModel = cliArgs.model;
  if (targetModel) {
    // Non-interactive: parse "provider/model-name" format
    const slashIdx = targetModel.indexOf('/');
    let providerName: string;
    let modelName: string;
    if (slashIdx >= 0) {
      providerName = targetModel.slice(0, slashIdx);
      modelName = targetModel.slice(slashIdx + 1);
    } else {
      // Fallback: treat as model name, find first matching provider
      const found = modelList.find(m => m.model.includes(targetModel));
      if (found) {
        providerName = found.provider;
        modelName = targetModel;
      } else {
        console.log(`Model "${targetModel}" not found in model_list.`);
        process.exit(0);
      }
    }

    const providerEntry = modelList.find(m => m.provider === providerName);
    if (!providerEntry || !providerEntry.model.includes(modelName)) {
      console.log(`Model "${targetModel}" not found in model_list.`);
      process.exit(0);
    }

    settings.default_model = `${providerEntry.provider}/${modelName}`;
    settings.env = settings.env ?? {};
    settings.env.CODER_MODEL = modelName;
    if (providerEntry.base_url) settings.env.CODER_BASE_URL = providerEntry.base_url;
    if (providerEntry.proxy) settings.env.CODER_PROXY = providerEntry.proxy;
    if (providerEntry.auth_token_env) settings.env.CODER_AUTH_TOKEN = providerEntry.auth_token_env;

    // Smart merge into model_list (match by provider)
    settings.model_list = settings.model_list ?? [];
    const existingIdx = settings.model_list.findIndex(
      (m: any) => m.provider === providerEntry.provider
    );
    if (existingIdx >= 0) {
      settings.model_list[existingIdx] = { ...settings.model_list[existingIdx], ...providerEntry };
    } else {
      settings.model_list.push(providerEntry);
    }

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log(`Default model set to: ${providerEntry.provider}/${modelName}`);
    process.exit(0);
  }

  // Interactive: delegate to shared function
  await runInteractiveModelSetup(settings, modelList, settingsPath, process.stdin, process.stdout, writeFileSync);
  process.exit(0);
}

// --setup: interactive first-time setup wizard
if (cliArgs.setup || process.argv.includes('setup')) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');
  const readline = await import('node:readline');
  const stdin = process.stdin;
  const stdout = process.stdout;

  const settingsPath = join(homedir(), '.coder', 'settings.json');
  let settings: any = {};
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  } catch {}
  settings.model_list = settings.model_list ?? [];

  console.log('\n🔧 Coder Agent — First Time Setup\n');

  // ── Step 1: Theme ──────────────────────────────────────────────────────────
  {
    const themeIdx = await radioSelect(
      ['dark', 'light'],
      0,
      'Choose theme:',
      stdin,
      stdout,
    );
    const theme = themeIdx === 1 ? 'light' : 'dark';
    settings.theme = theme;
    // Apply immediately for the current TUI session
    process.env.CODER_TUI_THEME = theme;
    console.log(`  Theme: ${theme}\n`);
  }

  // ── Step 2: max_tokens ─────────────────────────────────────────────────────
  {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const maxTokens = await new Promise<number>(resolve => {
      rl.question('Max output tokens [32768]: ', answer => {
        const trimmed = answer.trim();
        resolve(trimmed ? parseInt(trimmed, 10) || 32768 : 32768);
      });
    });
    settings.max_tokens = maxTokens;
    console.log(`  Max tokens: ${maxTokens}\n`);
    rl.close();
  }

  // ── Step 3: Provider + Model (reuses --model interactive flow) ────────────
  const modelList: Array<any> = settings.model_list;

  console.log('Now let us configure your AI provider and model.\n');
  await runInteractiveModelSetup(settings, modelList, settingsPath, process.stdin, process.stdout, writeFileSync);

  // ── Save and launch TUI ───────────────────────────────────────────────────
  // runInteractiveModelSetup already saved settings.json, but ensure theme
  // and max_tokens are persisted (they were set on the settings object above).
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  console.log('✅ Setup complete! Settings saved to ~/.coder/settings.json\n');
  console.log('Starting Coder Agent...\n');

  // Fall through to TUI init
}

// TTY check — skip for non-interactive flags handled above
const isNonInteractive = cliArgs.help || cliArgs.version || cliArgs.print || cliArgs.model || process.argv.includes('--model') || process.argv.includes('-m')
if (isNonInteractive) {
  // Exit gracefully — the --model handler above uses readline callback to exit
  if (!cliArgs.model && !process.argv.includes('--model') && !process.argv.includes('-m')) {
    process.exit(0)
  }
  // For --model: don't fall through to TUI init; readline callback handles exit
  // Use a no-op wait so the process stays alive for readline
  await new Promise(() => {})
}

// TTY check for interactive mode
if (!process.stdin.isTTY) {
  console.log('coder-tui: no TTY (use --help, --print, --version, or --model for non-TTY usage)')
  process.exit(0)
}

// Start from a clean slate. If a previous TUI crashed or was kill -9'd, the
// terminal tab can still have mouse/focus/paste modes enabled.
resetTerminalModes()

// Main-screen mode: keep prior terminal output intact so users can review
// earlier content via native scrollback.  Just start on a fresh line.
process.stdout.write('\n')

const gw = new CoderGatewayClient({
  coordinatorMode: cliArgs.coordinator || cliArgs.worker,
  teamId: cliArgs.team,
  workerMode: cliArgs.worker,
  maxWorkers: cliArgs.workers,
  thinkingMode: cliArgs.thinking,
  thinkingBudget: cliArgs.thinkingBudget,
  forkSessionId: cliArgs.forkSession,
  forkTurn: cliArgs.forkTurn,
})

gw.start()

setupGracefulExit({
  cleanups: [
    () => {
      resetTerminalModes()

      return gw.kill('graceful-exit-cleanup')
    }
  ],
  onError: (scope, err) => {
    const message = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err)

    process.stderr.write(`coder-tui lifecycle ${scope}: ${message.slice(0, 2000)}\n`)
  },
  onSignal: signal => {
    resetTerminalModes()
    process.stderr.write(`coder-tui lifecycle: received ${signal}\n`)
  }
})

// Defer memory monitoring and heap dump to after the TUI's first paint.
// Memory pressure detection is important but non-critical for startup (<500ms).
const stopMemoryMonitor = (() => {
  let stop: (() => void) | null = null;
  setImmediate(async () => {
    const [{ formatBytes }, { startMemoryMonitor: start }] = await Promise.all([
      import('./lib/memory.js'),
      import('./lib/memoryMonitor.js'),
    ]);
    const dumpNotice = (snap: { level: string; heapUsed: number }, dump: { heapPath?: string } | null) =>
      `coder-tui: ${snap.level} memory (${formatBytes(snap.heapUsed)}) — auto heap dump → ${dump?.heapPath ?? '(failed)'}\n`;
    stop = start({
      onCritical: (snap, dump) => {
        resetTerminalModes();
        process.stderr.write(`coder-tui lifecycle: memory critical exit heap=${formatBytes(snap.heapUsed)} rss=${formatBytes(snap.rss)}\n`);
        process.stderr.write(dumpNotice(snap, dump));
        process.stderr.write('coder-tui: exiting to avoid OOM; restart to recover\n');
        process.exit(137);
      },
      onHigh: (snap, dump) => process.stderr.write(dumpNotice(snap, dump)),
    });
  });
  return () => stop?.();
})();

if (process.env.CODER_HEAPDUMP_ON_START === '1') {
  setImmediate(() => {
    import('./lib/memory.js').then(m => void m.performHeapDump('manual'));
  });
}

process.on('beforeExit', () => stopMemoryMonitor())

// Apply user's theme preference from settings.json before TUI initializes.
// This overrides terminal auto-detection (detectLightMode) when the user
// has explicitly chosen a theme via `coder setup` or `coder --model`.
if (!process.env.CODER_TUI_THEME) {
  try {
    const settingsTheme = JSON.parse(
      (await import('node:fs')).readFileSync(
        (await import('node:path')).join((await import('node:os')).homedir(), '.coder', 'settings.json'),
        'utf-8',
      )
    )?.theme
    if (settingsTheme === 'light' || settingsTheme === 'dark') {
      process.env.CODER_TUI_THEME = settingsTheme
    }
  } catch {}
}

const [ink, { App }, { logFrameEvent }, { trackFrame }] = await Promise.all([
  import('@coder/tui'),
  import('./app.js'),
  import('./lib/perfPane.js'),
  import('./lib/fpsStore.js')
])

// Both consumers are undefined when their env flags are off; only attach
// onFrame when at least one is on so ink skips timing in the default case.
const onFrame =
  logFrameEvent || trackFrame
    ? (event: FrameEvent) => {
        logFrameEvent?.(event)
        trackFrame?.(event.durationMs)
      }
    : undefined

try {
  await ink.render(<App gw={gw} />, {
    exitOnCtrlC: false,
    onFrame,
    // Open URLs in the user's default browser when a link cell is clicked.
    // The TUI's mouse tracking captures click events before Terminal.app's
    // own URL detection can fire, so without this hook clicks on `<Link>`
    // do nothing in any terminal where mouseTracking is on.
    onHyperlinkClick: url => {
      openExternalUrl(url)
    }
  } as any)
} catch (err) {
  resetTerminalModes()
  const message = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err)
  process.stderr.write(`coder-tui: render failed — ${message.slice(0, 2000)}\n`)
  process.exit(1)
}
