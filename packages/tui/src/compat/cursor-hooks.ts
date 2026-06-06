/**
 * Cursor hooks compat stubs — Phase 1
 *
 * IME cursor positioning and external cursor advance.
 *
 * ## useDeclaredCursor
 * CA's TextInput uses useDeclaredCursor to register the rendered Box element
 * as a ref for IME pre-edit cursor positioning.  CA's original signature is:
 *   useDeclaredCursor(opts: {line, column, active}) => (el: any) => void
 * The returned callback ref is assigned to `<Box ref={boxRef}>`.
 *
 * In React 19 (used by ink v7), refs must be created by useRef/React.createRef
 * or be a ref-setter function.  Plain objects are rejected.
 * Our stub returns a valid ref-setter callback.
 */

import { useCallback } from 'react';

/**
 * Options passed by CA's TextInput to configure the declared cursor.
 */
export interface DeclaredCursorOptions {
  line: number;
  column: number;
  active: boolean;
}

// ---------------------------------------------------------------------------
// DeclaredCursorHandle
// ---------------------------------------------------------------------------

export interface DeclaredCursorHandle {
  /** Declare the cursor position for IME pre-edit text */
  setPosition(row: number, col: number): void;
}

// ---------------------------------------------------------------------------
// useDeclaredCursor
// ---------------------------------------------------------------------------

/**
 * Hook for IME pre-edit cursor positioning.
 *
 * Returns a ref-setter callback (compatible with React 19 ref rules) so
 * CA's TextInput can assign it as `ref={boxRef}` on an ink Box element.
 * IME cursor positioning is deferred — the callback is a no-op Phase 1 stub.
 */
export function useDeclaredCursor(
  _opts?: DeclaredCursorOptions,
): (el: any) => void {
  return useCallback((_el: any) => {
    // Phase 1: ref-setter stub — accepts the element but doesn't configure IME
  }, []);
}

// ---------------------------------------------------------------------------
// CursorAdvanceHandle — callable function type
// ---------------------------------------------------------------------------

export type CursorAdvanceHandle = (dx: number, dy?: number) => void;

// ---------------------------------------------------------------------------
// useCursorAdvance
// ---------------------------------------------------------------------------

/**
 * Hook for external cursor advance notifications (used by TextInput fast-echo bypass).
 * Returns a callable function: (dx: number, dy?: number) => void.
 * Phase 0 stub.
 */
export function useCursorAdvance(): CursorAdvanceHandle {
  return (_dx: number, _dy?: number) => {
    // Phase 0: no-op
  };
}
