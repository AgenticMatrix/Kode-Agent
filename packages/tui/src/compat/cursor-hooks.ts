/**
 * Cursor hooks compat stubs — Phase 3.3
 *
 * IME cursor positioning and external cursor advance.
 *
 * ## useDeclaredCursor
 * CA's TextInput uses useDeclaredCursor to register the rendered Box element
 * as a ref for IME pre-edit cursor positioning.  CA's original signature is:
 *   useDeclaredCursor(opts: {line, column, active}) => (el: any) => void
 * The returned callback ref is assigned to `<Box ref={boxRef}>`.
 *
 * Phase 3.3: Uses ink v7's built-in `useCursor` hook to integrate with ink's
 * cursor management pipeline instead of writing raw CSI sequences to stdout.
 *
 * ### Why raw CSI writes fail
 * Writing `\x1b[{row};{col}H` directly to stdout in useEffect runs OUTSIDE
 * ink's render pipeline.  Ink's log-update tracks `cursorWasShown`,
 * `cursorPosition`, and `previousCursorPosition` internally.  When our
 * external CSI writes move the cursor without updating ink's state:
 *
 * 1. `buildReturnToBottomPrefix` returns '' (ink thinks cursor was never
 *    shown), so `eraseLines` starts from wherever our CSI left the cursor —
 *    not the bottom of the output area — corrupting the display.
 * 2. `buildCursorSuffix` returns '' (cursorPosition is undefined from ink's
 *    perspective), so the next render hides or mispositions the cursor.
 *
 * ### How the ink v7 fix works
 * - `useCursor()` returns `{ setCursorPosition }` which integrates with
 *   ink's log-update cursor state.
 * - `useInsertionEffect` propagates the position to the context BEFORE
 *   `onRender`, so `buildCursorSuffix` emits the correct CSI as part of
 *   the output frame.
 * - Ink's `buildReturnToBottomPrefix` correctly returns the cursor to the
 *   bottom before erasing because `cursorWasShown` is tracked accurately.
 *
 * Trade-off: coordinates are computed in useEffect (runs after
 * useInsertionEffect), causing a 1-frame lag.  This is acceptable because
 * IME composition text position is read by the terminal once composition
 * starts, at which point the cursor has been positioned for many frames.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useCursor } from 'ink';

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
 *
 * On each render the hook:
 *   1. Captures the Box DOM element via the ref callback.
 *   2. In a post-render useEffect, walks up the Yoga node tree to compute
 *      the element's absolute position in terminal cells (0-indexed from
 *      the ink output origin).
 *   3. Adds the (line, column) offset from the cursor layout.
 *   4. Calls ink's `setCursorPosition({ x, y })` so ink's log-update
 *      includes the correct cursor suffix in the NEXT render frame.
 *
 * The cursor is always positioned at the computed coordinates — we never
 * hide it via `setCursorPosition(undefined)`.  The TextInput's nativeCursor
 * rendering path already handles the "no terminal focus / selection active"
 * cases by rendering a synthetic inverted-cell cursor instead.
 *
 * Silently no-ops when:
 *   - stdout is not a TTY (non-interactive / piped mode).
 *   - The Yoga node is not available (e.g. before the first layout pass).
 */
export function useDeclaredCursor(
  _opts?: DeclaredCursorOptions,
): (el: any) => void {
  const elRef = useRef<any>(null);
  const optsRef = useRef(_opts);
  optsRef.current = _opts;

  const { setCursorPosition } = useCursor();

  useEffect(() => {
    const opts = optsRef.current;
    if (!process.stdout.isTTY) return;

    const el = elRef.current;
    if (!el?.yogaNode) return;

    try {
      // Walk up the Yoga layout tree, summing top / left offsets to
      // compute the element's absolute position in terminal cells.
      let node = el.yogaNode;
      let absTop = 0;
      let absLeft = 0;

      while (node) {
        const layout = node.getComputedLayout();
        absTop += layout.top;
        absLeft += layout.left;
        node = node.getParent?.() ?? null;
      }

      // Ink's CursorPosition is 0-indexed from the ink output origin.
      // absTop/absLeft from the root Yoga node ARE the ink-relative
      // offsets (the Yoga root represents the entire ink output).
      // The +1 on y accounts for the terminal row offset between the
      // Yoga layout origin and the first ink-rendered row.
      setCursorPosition({
        x: absLeft + (opts?.column ?? 0),
        y: absTop + (opts?.line ?? 0) + 1,
      });
    } catch {
      // Yoga layout not yet computed — silently skip this frame.
      // The next render will retry once Yoga has calculated positions.
    }
  });

  // Ref-setter callback — captures the Box element for the effect above.
  return useCallback((el: any) => {
    elRef.current = el;
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
