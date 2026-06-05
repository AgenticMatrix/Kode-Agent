/**
 * useTabStatus compat stub — Phase 0
 *
 * Sets the terminal tab status indicator (OSC 21337).
 * Phase 0 stub is a no-op.
 */

export type TabStatus = 'idle' | 'busy' | 'waiting';

/**
 * Set the terminal tab status indicator.
 * Phase 0 stub: does nothing.
 */
export function useTabStatus(_status: TabStatus): void {
  // Phase 0: no-op. Full implementation sends OSC 21337 sequences
  // to indicate tab state in supporting terminals (iTerm2, WezTerm, etc.).
}
