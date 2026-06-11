/**
 * vsCodeGateway.ts — VSCodeGatewayClient (Sidecar mode)
 *
 * Spawns `coder --gateway` as a child process and communicates
 * via JSON-RPC over stdio. Zero engine code in the extension.
 */

import { spawn, ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { gatewayToWebview } from './gatewayToWebview';
import type { WebviewOutboundMessage } from '../types/webviewProtocol';

type MessageSender = (msg: WebviewOutboundMessage) => void;

export class VSCodeGatewayClient {
  private send: MessageSender;
  private proc: ChildProcess | null = null;
  private rl: ReturnType<typeof createInterface> | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private sessionId = '';
  private model = '';

  constructor(send: MessageSender) {
    this.send = send;
    this.startProcess();
  }

  private startProcess(): void {
    const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
    const tsxCli = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const cliEntry = path.join(projectRoot, 'src', 'cli', 'main.tsx');
    const isDev = existsSync(tsxCli) && existsSync(cliEntry);

    const cmd = process.env.CODER_BIN
      ? process.env.CODER_BIN
      : isDev ? process.execPath : 'coder';
    const args = process.env.CODER_BIN
      ? ['--gateway']
      : isDev ? [tsxCli, cliEntry, '--gateway'] : ['--gateway'];

    this.proc = spawn(cmd, args, {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    this.rl = createInterface({ input: this.proc.stdout! });
    let buffer = '';

    this.rl.on('line', (line: string) => {
      // debug: console.error('[vscode-gw]stdout line:', line.slice(0, 80));
      buffer += line;
      try {
        const msg = JSON.parse(buffer);
        buffer = '';

        if (msg.type === 'event' && msg.event) {
          // Inbound event from gateway
          for (const wm of gatewayToWebview(msg.event, this.sessionId)) {
            this.send(wm);
          }

          // Track model from gateway.ready
          if (msg.event.type === 'gateway.ready') {
            this.model = msg.event.payload?.model || '';
            this.send({
              type: 'configUpdate',
              config: { model: this.model, provider: '', permissionMode: 'ask' },
            });
            this.send({ type: 'statusUpdate', status: 'ready', message: `Ready — ${this.model}`, sessionId: '' });
          }

          // Track session from session.info
          if (msg.event.type === 'session.info') {
            this.sessionId = msg.event.session_id || this.sessionId;
          }
        } else if (msg.id !== undefined) {
          // RPC response
          const pending = this.pending.get(msg.id);
          if (pending) {
            this.pending.delete(msg.id);
            if (msg.error) pending.reject(new Error(msg.error.message));
            else pending.resolve(msg.result);
          }
        }
      } catch {
        // Partial JSON, wait for more lines
      }
    });

    this.proc.stderr!.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) this.send({ type: 'errorMessage', message: `[coder] ${msg}` });
    });
    this.proc.on('error', (err) => {
      this.send({ type: 'errorMessage', message: `Failed to start coder: ${err.message}` });
      this.send({ type: 'statusUpdate', status: 'error', message: 'CLI not found', sessionId: '' });
    });

    this.proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        this.send({ type: 'errorMessage', message: `Coder process exited with code ${code}` });
      }
    });
  }

  private rpc(method: string, params?: Record<string, unknown>): Promise<any> {
    if (!this.proc || !this.proc.stdin) {
      return Promise.reject(new Error('Process not running'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const req = JSON.stringify({ id, method, params }) + '\n';
      // debug: console.error('[vscode-gw]RPC write:', req.trim().slice(0, 80));
      this.proc!.stdin!.write(req);
      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('RPC timeout'));
        }
      }, 300_000);
    });
  }

  async submitPrompt(text: string): Promise<void> {
    // debug: console.error('[vscode-gw]submitPrompt sid:', this.sessionId, 'text:', text.slice(0, 30));
    const sid = this.sessionId;
    if (!sid) {
      // debug: console.error('[vscode-gw]creating session...');
      const result = await this.rpc('session.create');
      this.sessionId = result?.sessionId || '';
      // debug: console.error('[vscode-gw]session created:', this.sessionId);
    }

    // Set title from first message if untitled
    const title = text.length > 50 ? text.slice(0, 50) + '...' : text;
    this.send({ type: 'sessionSwitched', sessionId: this.sessionId, title });

    try {
      await this.rpc('prompt.submit', { text });
      this.send({ type: 'statusUpdate', status: 'ready', sessionId: this.sessionId });
    } catch (err: any) {
      this.send({ type: 'errorMessage', message: err.message || String(err) });
      this.send({ type: 'statusUpdate', status: 'error', message: 'Error', sessionId: this.sessionId });
    }
  }

  async interrupt(): Promise<void> {
    try { await this.rpc('interrupt'); } catch {}
  }

  async createSession(): Promise<void> {
    try {
      const result = await this.rpc('session.create');
      this.sessionId = result?.sessionId || '';
      this.send({ type: 'sessionHistory', messages: [], sessionId: this.sessionId });
      this.send({ type: 'sessionSwitched', sessionId: this.sessionId, title: result?.title || 'Untitled' });
      this.listSessions();
    } catch {}
  }

  async resumeSession(id: string): Promise<void> {
    try {
      const result = await this.rpc('session.resume', { session_id: id });
      this.sessionId = id;
      if (result?.messages) {
        this.send({ type: 'sessionHistory', messages: result.messages, sessionId: id });
      }
      this.send({ type: 'sessionSwitched', sessionId: id, title: result?.title || 'Untitled' });
      this.send({ type: 'statusUpdate', status: 'ready', message: 'Session resumed', sessionId: id });
    } catch (err: any) {
      this.send({ type: 'errorMessage', message: err.message });
    }
  }

  listSessions(): void {
    this.rpc('session.list').then((result) => {
      if (result?.sessions) {
        this.send({
          type: 'sessionList',
          sessions: result.sessions.map((s: any) => ({
            id: s.id, title: s.title, messageCount: s.turnCount, startedAt: s.createdAt,
          })),
        });
      }
    }).catch(() => {});
  }

  handleApproval(requestId: string, allowed: boolean): void {
    this.rpc('approval.respond', { request_id: requestId, allowed }).catch(() => {});
  }

  dispose(): void {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}
