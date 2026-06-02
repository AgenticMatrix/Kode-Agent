import { EventEmitter } from 'node:events'

import type { IGatewayClient } from './client.js'
import type { GatewayEvent } from './types.js'

type EventPayload = Record<string, unknown> | undefined | null

interface MockEvent {
  type: string
  payload?: EventPayload
  session_id?: string
}

const MOCK_SESSION_ID = 'mock-session-001'
const MOCK_MODEL = 'deepseek-v4-pro'

let mockTurnId = 0

export class MockGatewayClient extends EventEmitter implements IGatewayClient {
  private ready = false
  private subscribed = false
  private bufferedEvents: GatewayEvent[] = []

  constructor() {
    super()
    this.setMaxListeners(0)
  }

  start(): void {
    this.ready = true
    this.publish({ type: 'gateway.ready' })
  }

  kill(_reason?: string): void {
    this.ready = false
    this.subscribed = false
    this.bufferedEvents.length = 0
  }

  async request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    switch (method) {
      case 'session.create':
      case 'session.resume':
        return {
          session_id: MOCK_SESSION_ID,
          model: MOCK_MODEL,
          cwd: process.cwd(),
          version: 'coder-tui-standalone',
        } as unknown as T

      case 'session.list':
      case 'session.active_list':
        return [{ session_id: MOCK_SESSION_ID, model: MOCK_MODEL }] as unknown as T

      case 'session.most_recent':
        return { session_id: MOCK_SESSION_ID } as unknown as T

      case 'session.usage':
        return { tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, cost: 0 } as unknown as T

      case 'session.status':
        return { busy: false, model: MOCK_MODEL, turn_count: 0 } as unknown as T

      case 'session.compress': {
        // Mock: simulate a compaction removing ~half the messages
        const removed = 4
        return {
          removed,
          before_messages: 10,
          after_messages: 6,
          before_tokens: 5000,
          after_tokens: 3000,
          summary: { headline: `Compacted ${removed} messages (mock, snip)` },
          usage: { total: 2000 },
        } as unknown as T
      }

      case 'session.title':
      case 'session.save':
      case 'session.close':
      case 'session.delete':
      case 'session.undo':
      case 'session.branch':
      case 'session.activate':
      case 'session.interrupt':
      case 'session.steer':
        return null as unknown as T

      case 'config.full': {
        const config: Record<string, unknown> = {
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
            tui_auto_resume_recent: true,
            tui_compact: false,
            tui_status_indicator: 'kaomoji',
            tui_statusbar: 'bottom',
          },
          model: MOCK_MODEL,
          providers: {},
        }
        return config as unknown as T
      }

      case 'config.mtime':
        return 0 as unknown as T

      case 'config.get_value': {
        const gkey = (params?.key as string) ?? ''
        return { value: gkey ? '' : '' } as unknown as T
      }

      case 'config.set': {
        const val = (params?.value as string) ?? ''
        return { value: val } as unknown as T
      }

      case 'commands.catalog':
        return {
          categories: [],
          pairs: [],
          skill_count: 0,
        } as unknown as T

      case 'completion':
        return { items: [] } as unknown as T

      case 'slash.exec':
        return { output: '(mock: no backend connected)' } as unknown as T

      case 'command.dispatch':
        return { type: 'send', message: `/${params?.command ?? ''}` } as unknown as T

      case 'shell.exec':
        return { output: `[mock] shell exec: ${params?.command ?? ''}`, exit_code: 0 } as unknown as T

      case 'terminal.resize':
      case 'clipboard.paste':
      case 'input.detect_drop':
      case 'image.attach':
        return null as unknown as T

      case 'model.options':
        return { models: [MOCK_MODEL] } as unknown as T

      case 'tools.configure':
      case 'mcp.reload':
      case 'env.reload':
      case 'process.stop':
      case 'browser.manage':
        return null as unknown as T

      case 'delegation.status':
        return { max_spawn_depth: 3, max_concurrent_children: 5, paused: false } as unknown as T

      case 'delegation.pause':
      case 'subagent.interrupt':
        return null as unknown as T

      case 'spawn-tree.list':
        return [] as unknown as T

      case 'spawn-tree.load':
        return null as unknown as T

      case 'setup.status':
        return { providers_configured: true, skills_installed: true } as unknown as T

      case 'rollback.list':
        return [] as unknown as T

      case 'rollback.diff':
      case 'rollback.restore':
        return null as unknown as T

      case 'voice.toggle':
      case 'voice.record':
        return null as unknown as T

      case 'prompt.submit': {
        const turnId = ++mockTurnId
        const userText = (params?.text as string) ?? ''

        // Simulate an assistant response
        setTimeout(() => {
          this.publish({ type: 'message.start' })
          this.publish({
            type: 'message.delta',
            payload: {
              text: `## Mock Response\n\nYou said: "${userText}"\n\nThis is a **standalone mock** response from \`coder-tui\`.\n\nThe real Coder backend (Python gateway) is not connected.\n\n### Features available in mock mode:\n- Full TUI rendering (components, scrolling, markdown)\n- Text input and composer\n- Status bar and overlays\n- Virtual history and session management`,
            },
          })
          this.publish({ type: 'message.complete' })
          this.publish({ type: 'status.update', payload: { text: 'Ready' } })
        }, 500)

        return { turn_id: turnId, accepted: true } as unknown as T
      }

      default:
        return null as unknown as T
    }
  }

  drain(): void {
    this.subscribed = true
    for (const ev of this.bufferedEvents) {
      this.emit('event', ev)
    }
    this.bufferedEvents.length = 0
  }

  getLogTail(_limit?: number): string {
    return ''
  }

  private publish(ev: MockEvent): void {
    const event = ev as unknown as GatewayEvent
    if (this.subscribed) {
      this.emit('event', event)
    } else {
      this.bufferedEvents.push(event)
    }
  }
}
