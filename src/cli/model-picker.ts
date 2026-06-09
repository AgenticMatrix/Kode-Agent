/**
 * model-picker.ts — Interactive model selection for `coder --model`.
 *
 * Provides a terminal-based (non-TUI) interactive picker that lets users
 * browse providers, configure API keys, select models, and persist the
 * choice to ~/.coder/settings.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CoderSettings, ModelEntry } from './config.js';
import { inferProvider } from './config.js';

// ---------------------------------------------------------------------------
// radioSelect — Simple terminal picker (arrow keys + Enter)
// ---------------------------------------------------------------------------

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
    stdout.write('\x1B[?25l'); // hide cursor

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
      if (key === 13) { // Enter
        cleanup();
        resolve(selected);
        return;
      }
      if (key === 3) { // Ctrl+C
        cleanup();
        stdout.write('\n');
        process.exit(0);
      }
      if (key === 27 && data.length >= 3) {
        if (data[1] === 91) {
          if (data[2] === 65) { // Up arrow
            selected = (selected - 1 + options.length) % options.length;
            render();
          } else if (data[2] === 66) { // Down arrow
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
      stdout.write('\x1B[?25h\n'); // show cursor
    }

    stdin.on('data', onData);
  });
}

// ---------------------------------------------------------------------------
// runInteractiveModelSetup
// ---------------------------------------------------------------------------

export async function runInteractiveModelSetup(
  settings: CoderSettings,
  modelList: ModelEntry[],
  settingsPath: string,
  stdin: typeof process.stdin,
  stdout: typeof process.stdout,
): Promise<boolean> {
  const defaultModel = settings.default_model ?? '';
  const defaultProvider = defaultModel ? defaultModel.split('/')[0]! : 'deepseek';
  let selectedProvider: ModelEntry = modelList[0] ?? {
    provider: 'deepseek',
    model: ['deepseek-v4-pro'],
  };

  // ── Step 1: Provider selection ────────────────────────────────────
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
      // Custom new provider
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
        proxy: proxy.trim() || undefined,
      };
      modelList.push(selectedProvider);
      providerDone = true;
    } else if (selectedProviderIdx === modelList.length + 1) {
      // Remove provider
      const removeProviderOptions = modelList.map(m => m.provider ?? 'unknown');
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
        resolve,
      ));
      rl.close();
      if (confirm.trim().toLowerCase() === 'y') {
        settings.model_list = (settings.model_list ?? []).filter(
          (m: ModelEntry) => m.provider !== targetProvider,
        );
        if (settings.default_model?.startsWith(targetProvider + '/')) {
          settings.default_model = '';
        }
        const mdlIdx = modelList.findIndex(m => m.provider === targetProvider);
        if (mdlIdx >= 0) modelList.splice(mdlIdx, 1);
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        console.log(`Provider "${targetProvider}" removed. Returning to provider selection...\n`);
        continue;
      } else {
        console.log('Cancelled. Returning to provider selection...\n');
        continue;
      }
    } else if (selectedProviderIdx === modelList.length + 2) {
      console.log('Skipped. No changes made.');
      return false;
    } else {
      selectedProvider = modelList[selectedProviderIdx]!;
      providerDone = true;
    }
  }

  console.log(`Selected provider: ${selectedProvider.provider}\n`);

  // ── Provider config: base_url + api_key + proxy ──────────────────
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

  // ── Step 2: Model selection ─────────────────────────────────────
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
      modelDone = true;
    } else if (selectedModelIdx === selectedProvider.model.length + 1) {
      if (selectedProvider.model.length === 0) continue;
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
        resolve,
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
  }

  console.log(`Selected model: ${selectedModel}\n`);

  // ── Persist to settings.json ────────────────────────────────────
  settings.default_model = `${selectedProvider.provider}/${selectedModel}`;
  settings.env = settings.env ?? {};
  settings.env.CODER_MODEL = selectedModel;
  if (selectedProvider.base_url) settings.env.CODER_BASE_URL = selectedProvider.base_url;
  if (selectedProvider.auth_token_env) settings.env.CODER_AUTH_TOKEN = selectedProvider.auth_token_env;

  settings.model_list = settings.model_list ?? [];
  const existingIdx = settings.model_list.findIndex(
    (m: ModelEntry) => m.provider === selectedProvider.provider,
  );
  if (existingIdx >= 0) {
    settings.model_list[existingIdx] = { ...settings.model_list[existingIdx], ...selectedProvider };
  } else {
    settings.model_list.push(selectedProvider);
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log(`Default model set to: ${selectedProvider.provider}/${selectedModel}`);
  return true;
}

// ---------------------------------------------------------------------------
// handleModelFlag — entry point for `coder --model [value]`
// ---------------------------------------------------------------------------

export async function handleModelFlag(modelArg: string | undefined): Promise<void> {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');

  const settingsPath = join(homedir(), '.coder', 'settings.json');
  let settings: CoderSettings = {};
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as CoderSettings;
  } catch {
    // No settings file yet — start fresh
  }

  const modelList: ModelEntry[] = settings.model_list ?? [];

  if (modelList.length === 0) {
    console.log('No models configured. Add models to ~/.coder/settings.json model_list.');
    process.exit(0);
  }

  // Non-interactive mode: --model deepseek/deepseek-v4-pro
  if (modelArg) {
    const slashIdx = modelArg.indexOf('/');
    let providerName: string;
    let modelName: string;
    if (slashIdx >= 0) {
      providerName = modelArg.slice(0, slashIdx);
      modelName = modelArg.slice(slashIdx + 1);
    } else {
      const found = modelList.find(m => m.model.includes(modelArg));
      if (found) {
        providerName = found.provider ?? inferProvider(modelArg);
        modelName = modelArg;
      } else {
        console.log(`Model "${modelArg}" not found in model_list.`);
        process.exit(0);
      }
    }

    const providerEntry = modelList.find(m => m.provider === providerName);
    if (!providerEntry || !providerEntry.model.includes(modelName)) {
      console.log(`Model "${modelArg}" not found in model_list.`);
      process.exit(0);
    }

    settings.default_model = `${providerEntry.provider}/${modelName}`;
    settings.env = settings.env ?? {};
    settings.env.CODER_MODEL = modelName;
    if (providerEntry.base_url) settings.env.CODER_BASE_URL = providerEntry.base_url;
    if (providerEntry.proxy) settings.env.CODER_PROXY = providerEntry.proxy;
    if (providerEntry.auth_token_env) settings.env.CODER_AUTH_TOKEN = providerEntry.auth_token_env;

    const existingIdx = (settings.model_list ?? []).findIndex(m => m.provider === providerEntry.provider);
    if (existingIdx >= 0) {
      settings.model_list![existingIdx] = { ...settings.model_list![existingIdx], ...providerEntry };
    } else {
      settings.model_list!.push(providerEntry);
    }

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log(`Default model set to: ${providerEntry.provider}/${modelName}`);
    process.exit(0);
  }

  // Interactive mode: coder --model (no value)
  await runInteractiveModelSetup(settings, modelList, settingsPath, process.stdin, process.stdout);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// handleSetupFlag — first-time setup wizard: `coder setup` / `coder --setup`
// ---------------------------------------------------------------------------

export async function handleSetupFlag(): Promise<void> {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');
  const readline = await import('node:readline');
  const stdin = process.stdin;
  const stdout = process.stdout;

  const settingsPath = join(homedir(), '.coder', 'settings.json');
  let settings: CoderSettings = {};
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as CoderSettings;
  } catch {
    // No settings yet — start fresh
  }
  settings.model_list = settings.model_list ?? [];

  console.log('\n🔧 CoderAgent — First Time Setup\n');

  // ── Step 1: Theme ───────────────────────────────────────────────
  const themeIdx = await radioSelect(
    ['dark', 'light'],
    0,
    'Choose theme:',
    stdin,
    stdout,
  );
  const theme = themeIdx === 1 ? 'light' : 'dark';
  settings.theme = theme;
  console.log(`  Theme: ${theme}\n`);

  // ── Step 2: max_tokens ──────────────────────────────────────────
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

  // ── Step 3: Provider + Model ────────────────────────────────────
  const modelList: ModelEntry[] = settings.model_list;

  console.log('Now let\'s configure your AI provider and model.\n');
  await runInteractiveModelSetup(settings, modelList, settingsPath, process.stdin, process.stdout);

  // runInteractiveModelSetup already saved settings.json, but ensure theme
  // and max_tokens are persisted (they were set on the settings object above).
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  console.log('\n✅ Setup complete! Settings saved to ~/.coder/settings.json\n');
  console.log('Starting CoderAgent...\n');

  // Fall through to TUI init
}
