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
 * - The cursor position is computed during the render phase (via direct
 *   computation in the hook body, not in useEffect).  This runs BEFORE
 *   useCursor's useInsertionEffect, so positionRef.current is set before
 *   ink propagates it to the log-update context.
 * - On the first render, the Yoga node ref may not be available yet
 *   (the ref callback fires after render).  A setTimeout(0) correction
 *   with counter-based dedup handles this case robustly.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Walk up the Yoga layout tree and compute the element's absolute
 * position in terminal cells (0-indexed from the ink output origin).
 */
function computeAbsolutePosition(el: any): { absTop: number; absLeft: number } | null {
  if (!el?.yogaNode) return null;

  try {
    let node = el.yogaNode;
    let absTop = 0;
    let absLeft = 0;

    while (node) {
      const layout = node.getComputedLayout();
      absTop += layout.top;
      absLeft += layout.left;
      node = node.getParent?.() ?? null;
    }

    return { absTop, absLeft };
  } catch {
    return null;
  }
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
 *   2. During the render phase, walks up the Yoga node tree to compute
 *      the element's absolute position in terminal cells.
 *   3. Adds the (line, column) offset from the cursor layout.
 *   4. Calls ink's `setCursorPosition` to write to the position ref,
 *      so that useCursor's useInsertionEffect propagates it to log-update
 *      in the same frame.
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

  // Track whether we have emitted the blink-enable sequence.
  const blinkEmittedRef = useRef(false);

  // ── Counter-based dedup for first-frame Yoga layout correction ──────
  // The ref callback fires AFTER the first render.  On the first render,
  // elRef.current is null, so we can't compute the cursor position during
  // the render phase.  After the ref callback fires, the component won't
  // necessarily re-render (unless something else triggers it).
  //
  // We use a `refReady` state flag + setTimeout(0) correction to ensure
  // the cursor is positioned as soon as possible:
  //   1. Ref callback fires → setRefReady(true) → triggers re-render
  //   2. On the re-render, position is computed during render phase
  //   3. setTimeout(0) acts as a safety net for cases where Yoga hasn't
  //      settled by the first re-render after ref callback
  //
  // Counter dedup: if multiple setTimeout callbacks are scheduled before
  // the timer phase, only the latest one takes effect.
  const correctionCounterRef = useRef(0);
  const [refReady, setRefReady] = useState(false);

  // ── Stale Yoga layout correction ─────────────────────────────────────
  // During the render phase, getComputedLayout() returns the layout from
  // the PREVIOUS Yoga commit — not the layout that will be produced by the
  // CURRENT commit.  When content above the input box grows (e.g. after an
  // assistant response), the input element's absolute position changes but
  // the render-phase computation uses the old (higher) position.
  //
  // The post-commit useEffect below detects this discrepancy:
  //   1. Render phase computes position from stale Yoga → stores in lastPosRef
  //   2. useInsertionEffect propagates stale position to log-update
  //   3. Post-commit: Yoga layout is now fresh → recompute position
  //   4. If position differs from lastPosRef → setCursorPosition + force re-render
  //   5. Re-render: render phase uses fresh Yoga → position matches → stable
  //
  // The lastPosRef comparison prevents infinite re-render loops.
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const [, setCorrectionTick] = useState(0);

  // ── Compute cursor position during render phase ────────────────────
  // This is called during the render, BEFORE useCursor's useInsertionEffect
  // runs.  The setCursorPosition call only writes to a ref (positionRef),
  // so it's safe to call during render — no state changes, no side effects.
  //
  // On the first render, elRef.current is null because the ref callback
  // hasn't fired yet.  On subsequent renders (after the ref callback),
  // elRef.current is set and we can compute the position immediately.
  //
  // NOTE: getComputedLayout() returns the layout from the PREVIOUS Yoga
  // commit.  When the input box moves (e.g. after assistant output grows),
  // this computation produces a stale position.  The post-commit useEffect
  // below detects the discrepancy and triggers a correction re-render.
  const el = elRef.current;
  if (el?.yogaNode) {
    const pos = computeAbsolutePosition(el);
    if (pos) {
      const opts = optsRef.current;
      const x = pos.absLeft + (opts?.column ?? 0);
      const y = pos.absTop + (opts?.line ?? 0);

      // Store for post-commit comparison (detects stale Yoga layout).
      lastPosRef.current = { x, y };

      // Write to ink's positionRef synchronously during render.
      // useCursor's useInsertionEffect will read this and propagate
      // it to the log-update cursor context in the same frame.
      setCursorPosition({ x, y });

      // Enable cursor blinking on the first successful position computation.
      if (!blinkEmittedRef.current && process.stdout.isTTY) {
        process.stdout.write('\x1b[?12h');
        blinkEmittedRef.current = true;
      }
    }
  }

  // ── First-frame Yoga layout correction via setTimeout ──────────────
  // Schedule a correction after the current render cycle completes.
  // Uses setTimeout(0) instead of setImmediate because:
  //   - setImmediate callbacks live in the check phase and can be canceled
  //     by clearImmediate() in useEffect cleanup during React re-renders
  //   - setTimeout(0) fires in the timer phase and survives React's
  //     effect cleanup cycle
  //
  // The correction callback re-computes the position using the latest
  // Yoga layout and the latest cursor opts.  Counter dedup ensures only
  // the latest scheduled correction actually takes effect.
  useEffect(() => {
    const opts = optsRef.current;
    if (!process.stdout.isTTY) return;

    const correctionId = ++correctionCounterRef.current;

    const timerId = setTimeout(() => {
      // Only the latest correction takes effect
      if (correctionId !== correctionCounterRef.current) return;

      const el2 = elRef.current;
      const pos = computeAbsolutePosition(el2);
      if (!pos) return;

      const latestOpts = optsRef.current;
      setCursorPosition({
        x: pos.absLeft + (latestOpts?.column ?? 0),
        y: pos.absTop + (latestOpts?.line ?? 0),
      });

      // Also trigger a re-render so useInsertionEffect propagates the
      // position to log-update on the next frame.
      if (!refReady) {
        setRefReady(true);
      }
    }, 0);

    // NOTE: Intentionally NOT canceling the timeout in cleanup.
    // The counter dedup mechanism above handles stale corrections.
    // Canceling in cleanup would reintroduce the same bug
    // (setImmediate + clearImmediate being defeated by re-renders).
  });

  // ── Post-commit stale Yoga layout correction ──────────────────────
  // This useEffect (no deps) runs after EVERY commit with fresh Yoga layout.
  // It detects when the input element's absolute position changed between the
  // previous and current Yoga commits — a scenario the render phase cannot
  // detect because getComputedLayout() returns stale (pre-commit) values.
  //
  // Flow when layout changes:
  //   1. Render phase: lastPosRef = stalePos, setCursorPosition(stalePos)
  //   2. useInsertionEffect propagates stalePos to log-update → wrong cursor
  //   3. Post-commit useEffect: Yoga fresh → compute freshPos
  //   4. freshPos !== lastPosRef → setCursorPosition(freshPos) + setCorrectionTick
  //   5. Next render: render phase uses fresh Yoga → freshPos === lastPosRef
  //   6. useInsertionEffect propagates freshPos → correct cursor
  //   7. Post-commit useEffect: freshPos === lastPosRef → no-op → stable
  //
  // Counter state (correctionTick) is used instead of a boolean flag because
  // React may batch multiple setState(false) calls and skip the re-render.
  // An incrementing counter guarantees each correction triggers a distinct
  // state transition.
  useEffect(() => {
    const el = elRef.current;
    if (!el?.yogaNode) return;

    const pos = computeAbsolutePosition(el);
    if (!pos) return;

    const opts = optsRef.current;
    const x = pos.absLeft + (opts?.column ?? 0);
    const y = pos.absTop + (opts?.line ?? 0);

    const last = lastPosRef.current;
    if (!last || last.x !== x || last.y !== y) {
      // Yoga layout shifted post-commit — update cursor ref and force
      // a re-render so useCursor's useInsertionEffect propagates the
      // corrected position to log-update.
      setCursorPosition({ x, y });
      setCorrectionTick((t) => t + 1);
    }
  });

  // ── Ref callback ──────────────────────────────────────────────────
  // Triggers a re-render (via refReady state) when the ref is first set,
  // so the render-phase position computation can run with the Yoga node.
  const boxRefCallback = useCallback((el: any) => {
    elRef.current = el;
    if (el && !refReady) {
      setRefReady(true);
    }
  }, [refReady]);

  return boxRefCallback;
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
