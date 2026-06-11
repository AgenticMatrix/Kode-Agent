/**
 * index.tsx — Webview entry point
 *
 * Mounts the Preact app into the webview DOM. The VS Code API
 * (acquireVsCodeApi) is available in the webview sandbox.
 */

import { h, render } from 'preact';
import { App } from './app';
import './styles/theme.css';

const root = document.getElementById('root');
if (root) {
  render(h(App, null), root);
}
