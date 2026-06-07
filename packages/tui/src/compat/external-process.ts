/**
 * External process hooks compat stubs — Phase 0
 *
 * Pauses Ink rendering while an external process runs.
 * Phase 0 stub runs the callback immediately without pausing.
 */
import { useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Signature for a thunk that runs an external process. */
export type RunExternalProcess = () => Promise<void>;

// ---------------------------------------------------------------------------
// useExternalProcess
// ---------------------------------------------------------------------------

/**
 * Hook that returns a function to run an external process.
 * Phase 0 stub: just runs the command directly.
 */
export function useExternalProcess(): RunExternalProcess {
  return useCallback(async () => {
    // Phase 0: no-op
  }, []);
}

// ---------------------------------------------------------------------------
// withInkSuspended
// ---------------------------------------------------------------------------

/**
 * Imperative version — suspends Ink rendering while running the callback.
 * Phase 0 stub: just runs the thunk directly.
 */
export async function withInkSuspended(run: RunExternalProcess): Promise<void> {
  // Phase 0: no rendering pause. Full implementation would:
  //   1. Call ink.clear() / exit alt-screen
  //   2. Run the external process
  //   3. Re-enter alt-screen and redraw
  await run();
}
