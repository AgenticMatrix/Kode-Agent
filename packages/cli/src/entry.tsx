#!/usr/bin/env -S node --max-old-space-size=8192 --expose-gc
// Must be first import. If the user explicitly opts into truecolor, this
// nudges chalk / supports-color before either package is initialized.
import './lib/forceTruecolor.js'
import React from 'react'

import type { FrameEvent } from '@kode/tui'

import { TERMUX_TUI_MODE } from './config/env.js'
import { KodeGatewayClient } from './gateway/kode-client.js'
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
      default:
        break
    }
  }
  return args
}

const cliArgs = parseCliArgs(process.argv.slice(2))

// Sync CLI args to env vars so child processes and engine-factory can read them
if (cliArgs.coordinator) {
  process.env.KODE_COORDINATOR_MODE = 'true'
}
if (cliArgs.team) {
  process.env.KODE_TEAM_ID = cliArgs.team
}
if (cliArgs.worker) {
  process.env.KODE_WORKER_MODE = 'true'
}
if (cliArgs.thinking) {
  process.env.KODE_THINKING_MODE = 'true'
}
if (cliArgs.thinkingBudget != null) {
  process.env.KODE_THINKING_BUDGET = String(cliArgs.thinkingBudget)
}
if (cliArgs.model) {
  process.env.KODE_MODEL = cliArgs.model
}
if (cliArgs.provider) {
  process.env.KODE_PROVIDER = cliArgs.provider
}
if (cliArgs.systemPrompt) {
  process.env.KODE_APPEND_SYSTEM_PROMPT = cliArgs.systemPrompt
}

// --help: print usage and exit (non-TUI mode)
if (cliArgs.help) {
  console.log(`Usage: kode [options]

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
`);
  process.exit(0);
}

// --print: print last session summary and exit (non-TUI mode)
if (cliArgs.print) {
  const { SessionManager } = await import('@kode/core');
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
  console.log(`kode-agent ${pkg.version}`);
  console.log(`node ${process.version}`);
  console.log(`${process.platform} ${process.arch}`);
  process.exit(0);
}

// TTY check after --help/--print/--version handlers so those flags work without a terminal
if (!process.stdin.isTTY) {
  console.log('kode-tui: no TTY (use --help, --print, or --version for non-TTY usage)')
  process.exit(0)
}

// Start from a clean slate. If a previous TUI crashed or was kill -9'd, the
// terminal tab can still have mouse/focus/paste modes enabled.
resetTerminalModes()

// Desktop terminals benefit from a clean startup slate because the TUI usually
// runs in AlternateScreen. On Termux we keep prior output intact so users can
// review/copy earlier assistant replies after reopening the app.
if (TERMUX_TUI_MODE) {
  process.stdout.write('\n')
} else {
  process.stdout.write('\x1b[2J\x1b[H\x1b[3J')
}

const gw = new KodeGatewayClient({
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

    process.stderr.write(`kode-tui lifecycle ${scope}: ${message.slice(0, 2000)}\n`)
  },
  onSignal: signal => {
    resetTerminalModes()
    process.stderr.write(`kode-tui lifecycle: received ${signal}\n`)
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
      `kode-tui: ${snap.level} memory (${formatBytes(snap.heapUsed)}) — auto heap dump → ${dump?.heapPath ?? '(failed)'}\n`;
    stop = start({
      onCritical: (snap, dump) => {
        resetTerminalModes();
        process.stderr.write(`kode-tui lifecycle: memory critical exit heap=${formatBytes(snap.heapUsed)} rss=${formatBytes(snap.rss)}\n`);
        process.stderr.write(dumpNotice(snap, dump));
        process.stderr.write('kode-tui: exiting to avoid OOM; restart to recover\n');
        process.exit(137);
      },
      onHigh: (snap, dump) => process.stderr.write(dumpNotice(snap, dump)),
    });
  });
  return () => stop?.();
})();

if (process.env.KODE_HEAPDUMP_ON_START === '1') {
  setImmediate(() => {
    import('./lib/memory.js').then(m => void m.performHeapDump('manual'));
  });
}

process.on('beforeExit', () => stopMemoryMonitor())

const [ink, { App }, { logFrameEvent }, { trackFrame }] = await Promise.all([
  import('@kode/tui'),
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
  })
} catch (err) {
  resetTerminalModes()
  const message = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err)
  process.stderr.write(`kode-tui: render failed — ${message.slice(0, 2000)}\n`)
  process.exit(1)
}
