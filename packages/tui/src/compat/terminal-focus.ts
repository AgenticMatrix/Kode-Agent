/**
 * useTerminalFocus compat stub — Phase 0
 *
 * Tracks whether the terminal window has focus (DECSET 1004 focus reporting).
 * Phase 0 stub: always reports focused.
 */
import { useSyncExternalStore } from 'react';

/**
 * Returns true when the terminal has focus.
 * Phase 0 stub: always true.
 */
export function useTerminalFocus(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => true,
  );
}
