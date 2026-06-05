/**
 * Cursor hooks compat stubs — Phase 0
 *
 * IME cursor positioning and external cursor advance.
 * Phase 0 stubs are no-ops.
 */

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
 * Phase 0 stub — cursor position is never set.
 */
export function useDeclaredCursor(): DeclaredCursorHandle {
  return {
    setPosition: (_row: number, _col: number) => {},
  };
}
