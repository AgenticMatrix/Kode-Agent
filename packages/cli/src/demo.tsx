#!/usr/bin/env -S node --max-old-space-size=8192 --expose-gc
import React from 'react'
// Standalone demo entry point for coder-tui using MockGatewayClient.
// No Python backend required.

import './lib/forceTruecolor.js'

import type { FrameEvent } from '@coder/tui'

import { MockGatewayClient } from './gateway/mock-client.js'
import { setupGracefulExit } from './lib/gracefulExit.js'
import { openExternalUrl } from './lib/openExternalUrl.js'
import { resetTerminalModes } from './lib/terminalModes.js'
import { TERMUX_TUI_MODE } from './config/env.js'

if (!process.stdin.isTTY) {
  console.log('coder-tui: no TTY')
  process.exit(0)
}

resetTerminalModes()

if (TERMUX_TUI_MODE) {
  process.stdout.write('\n')
} else {
  process.stdout.write('\x1b[2J\x1b[H\x1b[3J')
}

const gw = new MockGatewayClient()

setupGracefulExit({
  cleanups: [
    () => {
      resetTerminalModes()
      return gw.kill('graceful-exit-cleanup')
    },
  ],
  onError: (scope, err) => {
    const message = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err)
    process.stderr.write(`coder-tui lifecycle ${scope}: ${message.slice(0, 2000)}\n`)
  },
  onSignal: (signal) => {
    resetTerminalModes()
    process.stderr.write(`coder-tui lifecycle: received ${signal}\n`)
  },
})

const [ink, { App }] = await Promise.all([
  import('@coder/tui'),
  import('./app.js'),
])

ink.render(<App gw={gw} />, {
  exitOnCtrlC: false,
  onHyperlinkClick: (url: string) => {
    openExternalUrl(url)
  },
} as any)
