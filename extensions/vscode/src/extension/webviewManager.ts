/**
 * webviewManager.ts — Manages the VS Code WebviewPanel lifecycle
 *
 * Creates and manages the chat webview panel. Handles message routing
 * between the webview and the gateway client.
 */

import type { ExtensionContext, WebviewPanel } from 'vscode';
import { window, ViewColumn, Uri, workspace } from 'vscode';
import type { WebviewOutboundMessage, WebviewInboundMessage } from '../types/webviewProtocol';
import type { VSCodeGatewayClient } from '../gateway/vsCodeGateway';

export class WebviewManager {
  private panel: WebviewPanel | null = null;
  private gateway: VSCodeGatewayClient | null = null;
  private context: ExtensionContext;

  constructor(context: ExtensionContext) {
    this.context = context;
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal(ViewColumn.Beside);
      return;
    }

    this.panel = window.createWebviewPanel(
      'coderChat',
      'Coder Agent',
      ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          Uri.joinPath(this.context.extensionUri, 'dist', 'webview'),
        ],
      },
    );

    this.panel.iconPath = Uri.joinPath(
      this.context.extensionUri,
      'resources',
      'icon.png',
    );

    // Load webview HTML
    const webviewUri = Uri.joinPath(
      this.context.extensionUri,
      'dist',
      'webview',
      'index.html',
    );
    const html = this.getHtmlContent(webviewUri);
    this.panel.webview.html = html;

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewInboundMessage) => {
        this.handleWebviewMessage(msg);
      },
      null,
      this.context.subscriptions,
    );

    // Clean up on dispose
    this.panel.onDidDispose(
      () => {
        this.panel = null;
        this.gateway?.dispose();
        this.gateway = null;
      },
      null,
      this.context.subscriptions,
    );
  }

  async getGateway(): Promise<VSCodeGatewayClient> {
    if (!this.gateway) {
      const { VSCodeGatewayClient } = await import('../gateway/vsCodeGateway');
      this.gateway = new VSCodeGatewayClient((msg: WebviewOutboundMessage) => this.postMessage(msg));
    }
    return this.gateway;
  }

  async createSession(): Promise<void> {
    (await this.getGateway()).createSession();
  }

  postMessage(msg: WebviewOutboundMessage): void {
    this.panel?.webview.postMessage(msg);
  }

  dispose(): void {
    this.gateway?.dispose();
    this.gateway = null;
    this.panel?.dispose();
    this.panel = null;
  }

  private async handleWebviewMessage(msg: WebviewInboundMessage): Promise<void> {
    // webviewReady: respond immediately without waiting for gateway
    if (msg.type === 'webviewReady') {
      return;
    }

    try {
      const gw = await this.getGateway();

      switch (msg.type) {
        case 'submitPrompt':
          gw.submitPrompt(msg.text);
          break;
        case 'interrupt':
          gw.interrupt();
          break;
        case 'approvalRespond':
          gw.handleApproval(msg.requestId, msg.allowed);
          break;
        case 'newSession':
          gw.createSession();
          break;
        case 'selectSession':
          gw.resumeSession(msg.sessionId);
          break;
        case 'openFile': {
          const fileUri = Uri.joinPath(workspace.workspaceFolders?.[0]?.uri ?? Uri.file(this.context.extensionUri.fsPath), msg.path);
          workspace.openTextDocument(fileUri).then(
            (doc) => window.showTextDocument(doc),
            () => window.showErrorMessage(`File not found: ${msg.path}`),
          );
          break;
        }
        case 'listSessions': {
          gw.listSessions();
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.postMessage({
        type: 'errorMessage',
        message: `Gateway error: ${message}`,
      });
    }
  }

  private getHtmlContent(webviewUri: Uri): string {
    // In production, webpack generates the HTML via HtmlWebpackPlugin.
    // For development, we serve a minimal page that loads the webview bundle.
    const scriptUri = Uri.joinPath(
      this.context.extensionUri,
      'dist',
      'webview',
      'webview.js',
    );
    const webviewScript = this.panel!.webview.asWebviewUri(scriptUri);

    const csp = `
      default-src 'none';
      style-src ${this.panel!.webview.cspSource} 'unsafe-inline';
      script-src ${this.panel!.webview.cspSource};
      font-src ${this.panel!.webview.cspSource};
    `.replace(/\s+/g, ' ').trim();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Coder Agent</title>
</head>
<body>
  <div id="root"></div>
  <script src="${webviewScript}"></script>
</body>
</html>`;
  }
}
