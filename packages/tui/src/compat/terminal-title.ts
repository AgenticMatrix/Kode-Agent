/**
 * useTerminalTitle compat stub — Phase 0
 *
 * Sets the terminal tab/window title (OSC 0/2).
 * Phase 0 is a no-op; full OSC title support deferred.
 */

/**
 * Set the terminal window / tab title.
 * Phase 0 stub — does nothing.
 */
export function useTerminalTitle(_title: string): void {
  // Phase 0: no-op. In full implementation, sends:
  //   process.stdout.write(`\x1b]0;${title}\x07`)
  // On Windows: process.title = title
}
