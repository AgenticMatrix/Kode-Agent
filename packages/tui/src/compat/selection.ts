/**
 * Selection hooks compat stubs — Phase 0
 *
 * Terminal text selection and clipboard copy.
 * Phase 0 stubs return inactive state; full selection system deferred.
 */
import { useSyncExternalStore } from 'react';

// ---------------------------------------------------------------------------
// Types (compatible with the old selection API)
// ---------------------------------------------------------------------------

export interface SelectionState {
  isActive: boolean;
  anchorRow?: number;
  anchorCol?: number;
  focusRow?: number;
  focusCol?: number;
}

// ---------------------------------------------------------------------------
// useHasSelection
// ---------------------------------------------------------------------------

/** Returns whether there is currently an active text selection. */
export function useHasSelection(): boolean {
  // Phase 0 stub: selection is never active
  return useSyncExternalStore(
    () => () => {},
    () => false,
    () => false,
  );
}

// ---------------------------------------------------------------------------
// useSelection
// ---------------------------------------------------------------------------

export interface SelectionHandle {
  copySelection(): Promise<string>;
  copySelectionNoClear(): Promise<string>;
  clearSelection(): void;
  hasSelection(): boolean;
  getState(): SelectionState;
  subscribe(listener: () => void): () => void;
  shiftAnchor(rows: number): void;
  shiftSelection(rows: number): void;
  moveFocus(direction: 'left' | 'right' | 'up' | 'down' | 'lineStart' | 'lineEnd'): void;
  captureScrolledRows(firstRow: number, lastRow: number, side: 'above' | 'below'): void;
  setSelectionBgColor(_color: string): void;
  readonly version: () => number;
}

/** Returns the full selection API. Phase 0 stub — all operations are no-ops. */
export function useSelection(): SelectionHandle {
  // Phase 0 stub: selection is always empty
  return {
    copySelection: async () => '',
    copySelectionNoClear: async () => '',
    clearSelection: () => {},
    hasSelection: () => false,
    getState: () => ({ isActive: false }),
    subscribe: () => () => {},
    shiftAnchor: () => {},
    shiftSelection: () => {},
    moveFocus: () => {},
    captureScrolledRows: () => {},
    setSelectionBgColor: () => {},
    version: () => 0,
  };
}
