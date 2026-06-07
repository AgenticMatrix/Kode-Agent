/**
 * forceRedraw — Phase 2.3
 *
 * Forces a full terminal redraw by sending ANSI escape sequences that
 * clear the screen and scrollback buffer.  After clearing, the next
 * render frame in Ink will re-paint the entire viewport from scratch.
 *
 * Strategy: use the standard "Erase in Display" sequences (`2J` +
 * `3J`) followed by a cursor-home (`H`).  This is gentler than RIS
 * (`\x1bc`) which resets to power-on defaults and can lose terminal
 * state (alternate screen, cursor shape, etc.).
 *
 * Non-TTY handling: if the provided stdout (or process.stdout) is not
 * a TTY (e.g. piped output, CI), the call is a safe no-op.
 */

/**
 * Erase in Display escape sequence — clears the entire screen.
 * Equivalent to `clear` command but keeps scrollback when used alone.
 */
const CSI_CLEAR_SCREEN = '\x1b[2J';

/**
 * Erase in Display escape sequence — clears the scrollback buffer.
 * Combined with `2J` this produces a fully blank terminal.
 *
 * Note: not all terminals support `3J` (e.g. some older xterm versions).
 * On unsupported terminals it is harmlessly ignored.
 */
const CSI_CLEAR_SCROLLBACK = '\x1b[3J';

/**
 * Cursor Position escape sequence — moves cursor to row 1, column 1.
 */
const CSI_CURSOR_HOME = '\x1b[H';

/**
 * Force the entire terminal to re-render.
 *
 * Sends clear-screen + clear-scrollback + cursor-home escape sequences
 * to the given stdout stream (defaults to `process.stdout`).  This
 * invalidates any cached screen state, causing the next Ink render
 * frame to produce a full diff that repaints the viewport.
 *
 * Safe to call in non-TTY environments — the function silently returns
 * without writing anything.
 *
 * @param stdout  Optional writable stream.  Defaults to `process.stdout`.
 */
export function forceRedraw(stdout?: NodeJS.WriteStream): void {
  const out = stdout ?? process.stdout;
  if (!out.isTTY) return;

  out.write(CSI_CLEAR_SCREEN + CSI_CLEAR_SCROLLBACK + CSI_CURSOR_HOME);
}
