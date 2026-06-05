/**
 * useStdin compat wrapper
 *
 * Wraps ink's useStdin to add the `inputEmitter` property that CA's CLI
 * code expects.  The primary keyboard input path goes through ink v7's
 * `useInput` hook (which reads stdin via the 'readable' event in paused
 * mode).  `inputEmitter` is a compat stub used only by `useFwdDelete` for
 * forward-delete sequence detection — basic typing and key handling are
 * unaffected by this stub.
 *
 * CRITICAL: Do NOT add any stdin event listener here.  Ink v7 relies on
 * the 'readable' event + stdin.read() in paused mode.  Adding a 'data'
 * listener switches the stream to flowing mode and breaks all useInput
 * hooks throughout the entire app.
 */
import { EventEmitter } from 'node:events';
import { useStdin as inkUseStdin } from 'ink';
import { useMemo } from 'react';

export interface StdinProps {
  /** The stdin stream */
  readonly stdin: NodeJS.ReadStream;
  /** Enable/disable raw mode on stdin */
  readonly setRawMode: (value: boolean) => void;
  /** Whether the current stdin supports setRawMode */
  readonly isRawModeSupported: boolean;
  /** CA compat: event emitter for raw input events (stub — primary input via useInput) */
  readonly inputEmitter: EventEmitter;
}

/**
 * Wraps ink's useStdin hook to provide the `inputEmitter` property.
 *
 * `inputEmitter` is a passive stub — it is NOT wired to stdin because
 * adding any listener to stdin would conflict with ink v7's own stdin
 * handling.  Primary keyboard input flows through ink's useInput hook,
 * which our compat useInput wrapper correctly delegates to.
 */
export function useStdin(): StdinProps {
  const publicProps = inkUseStdin();
  const inputEmitter = useMemo(() => new EventEmitter(), []);

  return {
    stdin: publicProps.stdin,
    setRawMode: publicProps.setRawMode,
    isRawModeSupported: publicProps.isRawModeSupported,
    inputEmitter,
  };
}

export default useStdin;
