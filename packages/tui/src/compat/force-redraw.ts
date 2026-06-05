/**
 * forceRedraw compat stub — Phase 0
 *
 * Forces a full redraw of the terminal.
 * Phase 0 stub is a no-op.
 */

/** Force the entire terminal to re-render. Accepts optional stdout stream for compatibility. */
export function forceRedraw(_stdout?: NodeJS.WriteStream): void {
  // Phase 0: no-op. Full implementation invalidates the screen buffer
  // and triggers a full-frame diff on the next render cycle.
}
