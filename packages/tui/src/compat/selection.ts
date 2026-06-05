/**
 * Selection hooks — Phase 2.1
 *
 * Real text selection and clipboard copy for terminal UIs.
 *
 * Features:
 *   - Anchor/focus coordinate tracking with row+col granularity
 *   - OSC 52 terminal clipboard copy (`\x1b]52;c;<base64>\x07`)
 *   - Scroll-aware: captureScrolledRows adjusts coordinates when content scrolls
 *   - React integration via useSyncExternalStore (concurrent-mode safe)
 *   - Directional focus movement (arrow keys, lineStart/lineEnd)
 *
 * Constraints:
 *   - Zero new npm dependencies — uses Node.js Buffer + process.stdout
 *   - SelectionHandle / SelectionState signatures unchanged
 */

import { useSyncExternalStore } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SelectionState {
  isActive: boolean;
  anchorRow?: number;
  anchorCol?: number;
  focusRow?: number;
  focusCol?: number;
}

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

// ---------------------------------------------------------------------------
// Internal store (module-level singleton)
// ---------------------------------------------------------------------------

interface InternalState {
  isActive: boolean;
  anchorRow: number | undefined;
  anchorCol: number | undefined;
  focusRow: number | undefined;
  focusCol: number | undefined;
  bgColor: string;
}

let state: InternalState = {
  isActive: false,
  anchorRow: undefined,
  anchorCol: undefined,
  focusRow: undefined,
  focusCol: undefined,
  bgColor: '',
};

/** Row index → text content (populated by terminal renderer integration) */
const textRows = new Map<number, string>();

const listeners = new Set<() => void>();
let versionCounter = 0;

function notify(): void {
  versionCounter++;
  for (const fn of listeners) {
    fn();
  }
}

/** Snap an immutable copy of the current state. */
function snapshot(): SelectionState {
  return {
    isActive: state.isActive,
    anchorRow: state.anchorRow,
    anchorCol: state.anchorCol,
    focusRow: state.focusRow,
    focusCol: state.focusCol,
  };
}

/** Whether there's a meaningful (non-degenerate) selection. */
function hasValidSelection(): boolean {
  if (!state.isActive) return false;
  if (state.anchorRow === undefined || state.focusRow === undefined) return false;
  if (state.anchorCol === undefined || state.focusCol === undefined) return false;
  // Degenerate: single-cell selection
  if (state.anchorRow === state.focusRow && state.anchorCol === state.focusCol) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Text extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract the selected text from the internal text-row buffer.
 * Walks from the topmost selected row to the bottommost, respecting
 * partial-row column boundaries.
 */
function getSelectedText(): string {
  if (!hasValidSelection()) return '';

  const anchorRow = state.anchorRow!;
  const anchorCol = state.anchorCol!;
  const focusRow = state.focusRow!;
  const focusCol = state.focusCol!;

  const startRow = Math.min(anchorRow, focusRow);
  const endRow = Math.max(anchorRow, focusRow);

  if (startRow === endRow) {
    // Single-row selection
    const rowText = textRows.get(startRow) ?? '';
    const startCol = Math.min(anchorCol, focusCol);
    const endCol = Math.max(anchorCol, focusCol);
    return rowText.slice(startCol, endCol);
  }

  // Multi-row selection
  const lines: string[] = [];

  // Determine which endpoint is the "start" row vs the "end" row
  const isAnchorTop = anchorRow === startRow;
  const firstRowStartCol = isAnchorTop ? anchorCol : focusCol;
  const lastRowEndCol = isAnchorTop ? focusCol : anchorCol;

  // First (partial) row: from startCol to end of row
  const firstRowText = textRows.get(startRow) ?? '';
  lines.push(firstRowText.slice(firstRowStartCol));

  // Full intermediate rows
  for (let r = startRow + 1; r < endRow; r++) {
    lines.push(textRows.get(r) ?? '');
  }

  // Last (partial) row: from start of row to endCol
  const lastRowText = textRows.get(endRow) ?? '';
  lines.push(lastRowText.slice(0, lastRowEndCol));

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// OSC 52 clipboard copy
// ---------------------------------------------------------------------------

/**
 * Write text to the system clipboard via OSC 52 terminal escape sequence.
 *
 * Format: `\x1b]52;c;<base64-encoded-text>\x07`
 *
 * OSC 52 is supported by most modern terminals (iTerm2, Kitty, WezTerm,
 * Windows Terminal, foot, etc.) and works over SSH when enabled.
 *
 * Falls back silently if the terminal doesn't support it.
 */
function writeOsc52(text: string): void {
  if (!text) return;
  const base64 = Buffer.from(text, 'utf-8').toString('base64');
  process.stdout.write(`\x1b]52;c;${base64}\x07`);
}

// ---------------------------------------------------------------------------
// Focus movement helpers
// ---------------------------------------------------------------------------

/** Get the length of the text on a given row (0 if unknown). */
function rowLength(row: number): number {
  return (textRows.get(row) ?? '').length;
}

/** Clamp a column value to [0, rowLength). */
function clampCol(row: number, col: number): number {
  const max = rowLength(row);
  if (col < 0) return 0;
  if (max === 0) return 0;
  return Math.min(col, max);
}

// ---------------------------------------------------------------------------
// Public API: useHasSelection
// ---------------------------------------------------------------------------

/** Returns whether there is currently an active text selection. */
export function useHasSelection(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => hasValidSelection(),
    () => false,
  );
}

// ---------------------------------------------------------------------------
// Public API: useSelection
// ---------------------------------------------------------------------------

/** Returns the full selection API handle. */
export function useSelection(): SelectionHandle {
  // Subscribe via useSyncExternalStore to ensure re-renders on selection changes.
  // We track the version counter as the store value.
  const _version = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => versionCounter,
    () => 0,
  );
  void _version; // used to trigger re-render on state changes

  // -----------------------------------------------------------------------
  // Clipboard
  // -----------------------------------------------------------------------

  async function copySelection(): Promise<string> {
    const text = getSelectedText();
    if (text) {
      writeOsc52(text);
    }
    clearSelection();
    return text;
  }

  async function copySelectionNoClear(): Promise<string> {
    const text = getSelectedText();
    if (text) {
      writeOsc52(text);
    }
    return text;
  }

  // -----------------------------------------------------------------------
  // State management
  // -----------------------------------------------------------------------

  function clearSelection(): void {
    state.isActive = false;
    state.anchorRow = undefined;
    state.anchorCol = undefined;
    state.focusRow = undefined;
    state.focusCol = undefined;
    notify();
  }

  function hasSelection(): boolean {
    return hasValidSelection();
  }

  function getState(): SelectionState {
    return snapshot();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  // -----------------------------------------------------------------------
  // Coordinate manipulation
  // -----------------------------------------------------------------------

  function shiftAnchor(rows: number): void {
    if (state.anchorRow === undefined) return;
    state.anchorRow = Math.max(0, state.anchorRow + rows);
    notify();
  }

  function shiftSelection(rows: number): void {
    if (state.focusRow === undefined) return;
    state.focusRow = Math.max(0, state.focusRow + rows);
    notify();
  }

  function moveFocus(
    direction: 'left' | 'right' | 'up' | 'down' | 'lineStart' | 'lineEnd',
  ): void {
    if (state.focusRow === undefined || state.focusCol === undefined) return;

    switch (direction) {
      case 'left':
        state.focusCol = clampCol(state.focusRow, state.focusCol - 1);
        break;
      case 'right':
        // Allow moving one past the end of line (for selecting trailing content)
        state.focusCol = Math.max(0, state.focusCol + 1);
        break;
      case 'up':
        state.focusRow = Math.max(0, state.focusRow - 1);
        state.focusCol = clampCol(state.focusRow, state.focusCol);
        break;
      case 'down':
        state.focusRow = state.focusRow + 1;
        state.focusCol = clampCol(state.focusRow, state.focusCol);
        break;
      case 'lineStart':
        state.focusCol = 0;
        break;
      case 'lineEnd': {
        const len = rowLength(state.focusRow);
        state.focusCol = Math.max(0, len);
        break;
      }
    }
    notify();
  }

  // -----------------------------------------------------------------------
  // Scroll handling
  // -----------------------------------------------------------------------

  /**
   * Adjust selection coordinates when terminal content scrolls.
   *
   * When rows scroll off the top of the viewport ('above'), all tracked
   * row indices shift up by the scroll amount. Selection coordinates on
   * scrolled-off rows are clamped to the new viewport boundary.
   *
   * When rows scroll off the bottom ('below'), text rows above are
   * preserved. This is typically used when the terminal history buffer
   * scrolls.
   */
  function captureScrolledRows(
    firstRow: number,
    lastRow: number,
    side: 'above' | 'below',
  ): void {
    const scrollCount = lastRow - firstRow + 1;

    if (side === 'above') {
      // Rows scrolled off the top — shift everything up
      const removedRows = new Set<number>();
      for (let r = firstRow; r <= lastRow; r++) {
        removedRows.add(r);
      }

      // Rebuild textRows with shifted indices
      const newTextRows = new Map<number, string>();
      for (const [row, text] of textRows) {
        if (removedRows.has(row)) continue;
        const newRow = row - scrollCount;
        if (newRow >= 0) {
          newTextRows.set(newRow, text);
        }
      }
      textRows.clear();
      for (const [row, text] of newTextRows) {
        textRows.set(row, text);
      }

      // Shift selection coordinates
      if (state.anchorRow !== undefined) {
        state.anchorRow = Math.max(0, state.anchorRow - scrollCount);
      }
      if (state.focusRow !== undefined) {
        state.focusRow = Math.max(0, state.focusRow - scrollCount);
      }
    } else {
      // Rows scrolled off the bottom — remove them from text buffer
      for (let r = firstRow; r <= lastRow; r++) {
        textRows.delete(r);
      }
    }

    notify();
  }

  function setSelectionBgColor(_color: string): void {
    if (state.bgColor === _color) return;
    state.bgColor = _color;
    notify();
  }

  function version(): number {
    return versionCounter;
  }

  return {
    copySelection,
    copySelectionNoClear,
    clearSelection,
    hasSelection,
    getState,
    subscribe,
    shiftAnchor,
    shiftSelection,
    moveFocus,
    captureScrolledRows,
    setSelectionBgColor,
    version,
  };
}

// ---------------------------------------------------------------------------
// Internal API: text row registry
//
// These functions are NOT part of the public SelectionHandle interface.
// They are used internally by the terminal renderer to feed text content
// into the selection system. Exported so that future renderer integration
// can import them from this module.
// ---------------------------------------------------------------------------

/**
 * Register text content for a terminal row.
 * Called by the terminal renderer as it outputs lines.
 */
export function setRowText(row: number, text: string): void {
  textRows.set(row, text);
}

/**
 * Remove text content for a terminal row.
 */
export function deleteRowText(row: number): void {
  textRows.delete(row);
}

/**
 * Clear all registered text rows.
 */
export function clearAllTextRows(): void {
  textRows.clear();
}

/**
 * Get the text registered for a specific row.
 */
export function getRowText(row: number): string | undefined {
  return textRows.get(row);
}
