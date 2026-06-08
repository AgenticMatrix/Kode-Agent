/**
 * useVsCodeApi.ts — Safe access to the VS Code webview API
 *
 * Returns a stable reference to the VS Code API object.
 * Only available inside a VS Code webview sandbox.
 */

interface VSCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeApi;

let cachedApi: VSCodeApi | null = null;

function getApi(): VSCodeApi {
  if (!cachedApi) {
    try {
      cachedApi = acquireVsCodeApi();
    } catch {
      // Fallback for testing outside VS Code
      cachedApi = {
        postMessage: (_msg: unknown) => {},
        getState: () => ({}),
        setState: (_state: unknown) => {},
      };
    }
  }
  return cachedApi;
}

export function useVsCodeApi(): VSCodeApi {
  return getApi();
}
