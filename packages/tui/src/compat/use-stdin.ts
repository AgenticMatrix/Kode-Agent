/**
 * useStdin compat wrapper — Phase 0
 *
 * Wraps ink's useStdin to add the `inputEmitter` property that CA's CLI
 * code expects. ink v7 doesn't expose the internal event emitter, so we
 * provide a standalone EventEmitter for Phase 0 compat.
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
  /** CA compat: event emitter for raw input events */
  readonly inputEmitter: EventEmitter;
}

/**
 * Wraps ink's useStdin hook to provide the `inputEmitter` property
 * that CA's textInput uses for listening to raw stdin events.
 * Phase 0: provides a stub EventEmitter — full raw input passthrough
 * will be implemented in a later phase.
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
