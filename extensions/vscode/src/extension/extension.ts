import type { ExtensionContext } from 'vscode';
import { window, commands } from 'vscode';
import { WebviewManager } from './webviewManager';

let webviewManager: WebviewManager | null = null;

function sendTheme(): void {
  const kind = window.activeColorTheme.kind === 2 || window.activeColorTheme.kind === 3
    ? 'dark' : 'light';
  webviewManager?.postMessage({ type: 'themeChange', kind });
}

export function activate(context: ExtensionContext): void {
  webviewManager = new WebviewManager(context);

  context.subscriptions.push(
    commands.registerCommand('coder.chat.start', () => {
      webviewManager?.show();
      sendTheme();
    }),
    commands.registerCommand('coder.chat.newSession', async () => {
      const gw = await webviewManager?.getGateway();
      gw?.createSession();
      window.showInformationMessage('New Coder session created.');
    }),
    window.onDidChangeActiveColorTheme(() => sendTheme()),
  );
}

export function deactivate(): void {
  if (webviewManager) {
    webviewManager.dispose();
    webviewManager = null;
  }
}
