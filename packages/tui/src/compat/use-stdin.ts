/**
 * useStdin compat wrapper
 *
 * Wraps ink's internal useStdinContext to expose the `inputEmitter` property
 * that CA's CLI code expects.
 *
 * ## Design
 * - Uses ink's `internal_eventEmitter` directly via `useStdinContext()`
 *   (imported from `ink/internal` — a patched export path in ink's package.json
 *   because `useStdinContext` is not part of ink's public API).
 * - This is the same EventEmitter that ink's `useInput` and `usePaste` hooks
 *   listen to internally, so forwarding input through it is safe — it does NOT
 *   interfere with ink's stdin stream mode (paused mode via 'readable' event).
 * - The primary keyboard input path goes through ink's `useInput` hook.
 *   `inputEmitter` is used only by CA's `useFwdDelete` for forward-delete
 *   sequence detection.
 *
 * ## Why NOT stdin.on('data')
 * Adding a 'data' listener to stdin switches the stream from paused to flowing
 * mode.  Ink v7 relies on the 'readable' event + stdin.read() in paused mode
 * for its own input handling.  Flowing mode breaks all useInput hooks
 * throughout the entire app.
 */
import { EventEmitter } from 'node:events';
import { useStdinContext } from 'ink/internal';

export interface StdinProps {
  /** The stdin stream */
  readonly stdin: NodeJS.ReadStream;
  /** Enable/disable raw mode on stdin */
  readonly setRawMode: (value: boolean) => void;
  /** Whether the current stdin supports setRawMode */
  readonly isRawModeSupported: boolean;
  /** CA compat: ink's internal_eventEmitter — used by useFwdDelete for forward-delete detection */
  readonly inputEmitter: EventEmitter;
}

/**
 * Wraps ink's useStdinContext hook to provide the `inputEmitter` property.
 *
 * `inputEmitter` is ink's own `internal_eventEmitter` — the same EventEmitter
 * that ink's useInput/usePaste hooks listen to.  This ensures CA's useFwdDelete
 * sees the same input events without interfering with ink's stdin stream mode.
 */
export function useStdin(): StdinProps {
  const {
    stdin,
    setRawMode,
    isRawModeSupported,
    internal_eventEmitter,
  } = useStdinContext();

  return {
    stdin,
    setRawMode,
    isRawModeSupported,
    inputEmitter: internal_eventEmitter,
  };
}

export default useStdin;
