/**
 * Terminal detection compat stub — Phase 0
 *
 * Detects terminal type via TERM / TERM_PROGRAM environment variables.
 * Simple implementation that covers the common cases used by CLI code.
 */

/**
 * Returns true when running inside xterm.js (VS Code, Cursor, Windsurf, etc.).
 * Detection is based on TERM_PROGRAM and XTERM_VERSION environment variables.
 */
export function isXtermJs(): boolean {
  // Phase 0: simple env-based detection.
  // Full implementation would also check XTVERSION (CSI > 0 q DCS response).
  const termProgram = process.env['TERM_PROGRAM'] ?? '';
  const xtermVersion = process.env['XTERM_VERSION'] ?? '';

  if (xtermVersion) return true;

  // Common xterm.js-based terminals
  const xtermJsPrograms = ['vscode', 'cursor', 'windsurf'];
  return xtermJsPrograms.includes(termProgram.toLowerCase());
}
