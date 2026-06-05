/**
 * useTerminalViewport compat stub — Phase 0
 *
 * Detects whether an element is visible in the terminal viewport.
 * Phase 0 stub: always reports visible.
 */
import { useSyncExternalStore } from 'react';
import type { RefObject } from 'react';

export interface ViewportState {
  isVisible: boolean;
  absoluteTop: number;
}

/**
 * Returns viewport visibility for the given element ref.
 * Phase 0 stub: always reports visible.
 */
export function useTerminalViewport(
  _ref: RefObject<unknown>,
): ViewportState {
  return useSyncExternalStore(
    () => () => {},
    () => ({ isVisible: true, absoluteTop: 0 }),
    () => ({ isVisible: true, absoluteTop: 0 }),
  );
}
