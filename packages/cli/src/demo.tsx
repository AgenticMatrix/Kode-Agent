#!/usr/bin/env -S node --max-old-space-size=8192 --expose-gc
import React from 'react'
// Standalone demo entry point for kode-tui using MockGatewayClient.
// No Python backend required.

import './lib/forceTruecolor.js'

import type { FrameEvent } from '@kode/tui'

import { MockGatewayClient } from './gateway/mock-client.js'
import { setupGracefulExit } from './lib/gracefulExit.js'
import { openExternalUrl } from './lib/openExternalUrl.js'
import { resetTerminalModes } from './lib/terminalModes.js'
import { TERMUX_TUI_MODE } from './config/env.js'

if (!process.stdin.isTTY) {
  console.log('kode-tui: no TTY')
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
    process.stderr.write(`kode-tui lifecycle ${scope}: ${message.slice(0, 2000)}\n`)
  },
  onSignal: (signal) => {
    resetTerminalModes()
    process.stderr.write(`kode-tui lifecycle: received ${signal}\n`)
  },
})

const [ink, { App }] = await Promise.all([
  import('@kode/tui'),
  import('./app.js'),
])

ink.render(<App gw={gw} />, {
  exitOnCtrlC: false,
  onHyperlinkClick: (url: string) => {
    openExternalUrl(url)
  },
})
