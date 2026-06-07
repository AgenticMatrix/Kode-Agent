/**
 * Mouse Tracker — Phase 2
 *
 * Shared mouse event infrastructure for CA compat components (Box,
 * ScrollBox, NoSelect).  Manages SGR extended mouse tracking, parses
 * incoming escape sequences, and dispatches typed events to registered
 * component handlers.
 *
 * ## Protocol
 *
 * SGR extended mouse mode (DECSET 1000 + 1006):
 *   CSI ? 1000 h  — enable basic mouse tracking
 *   CSI ? 1006 h  — enable SGR extended coordinates
 *   CSI < btn ; x ; y M  — mouse press / drag / wheel
 *   CSI < btn ; x ; y m  — mouse release
 *
 * btn encoding (6-bit + modifiers):
 *   0–2   = left / middle / right press
 *   32–34 = left / middle / right drag (bit 5 set)
 *   64–65 = wheel up / down (bit 6 set)
 *
 * x, y are 1-indexed terminal cell coordinates.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { useInput } from 'ink';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** SGR mouse action kind */
export type MouseAction =
  | 'press'
  | 'release'
  | 'drag'
  | 'wheel-up'
  | 'wheel-down';

/** Parsed low-level SGR mouse event (terminal-absolute coordinates) */
export interface SgrMouseEvent {
  /** 0 = left, 1 = middle, 2 = right; 3 = wheel-up, 4 = wheel-down */
  button: number;
  /** Terminal column (1-indexed) */
  x: number;
  /** Terminal row (1-indexed) */
  y: number;
  /** Action type decoded from the SGR suffix */
  action: MouseAction;
  /** Prevents the event from being dispatched to later handlers */
  stopImmediatePropagation(): void;
  /** Whether propagation was stopped */
  readonly propagationStopped: boolean;
}

/**
 * High-level mouse event passed to component callbacks.
 *
 * Coordinates are terminal-absolute in Phase 2 — components that need
 * element-local coordinates should subtract the element's top-left
 * position (deferred to a later phase with ink layout introspection).
 */
export interface MouseEventLite {
  button: number;
  /** Terminal column (0-indexed, from SGR x-1) */
  localCol: number;
  /** Terminal row (0-indexed, from SGR y-1) */
  localRow: number;
  /** Whether the cell at this position is blank (Phase 2: always false) */
  cellIsBlank: boolean;
  /** Stops further propagation of this event */
  stopImmediatePropagation(): void;
}

/** Handler signature registered by components */
export type MouseEventHandler = (event: SgrMouseEvent) => void;

// ---------------------------------------------------------------------------
// Context value
// ---------------------------------------------------------------------------

interface MouseTrackerContextValue {
  /**
   * Register a mouse event handler.  Returns an unregister function.
   * Registration auto-enables SGR tracking if not already active.
   */
  registerHandler(handler: MouseEventHandler): () => void;
}

const MouseTrackerContext = createContext<MouseTrackerContextValue | null>(null);

// ---------------------------------------------------------------------------
// SGR parsing
// ---------------------------------------------------------------------------

// SGR extended mouse escape sequence.
// Format: [< btn ; x ; y M/m
// NOTE: ink v7 strips the \x1b (ESC) prefix from unrecognised sequences
// in useInput's handleData before passing to handlers.  The regex must
// match the stripped form, not the raw terminal bytes.
const SGR_MOUSE_RE = /^\[<(\d+);(\d+);(\d+)([Mm])$/;

function parseSgr(input: string): SgrMouseEvent | null {
  const m = SGR_MOUSE_RE.exec(input);
  if (!m) return null;

  const rawBtn = parseInt(m[1]!, 10);
  const x = parseInt(m[2]!, 10);
  const y = parseInt(m[3]!, 10);
  const suffix = m[4]!;

  let button: number;
  let action: MouseAction;

  if (rawBtn >= 64) {
    // Wheel events — encode as virtual buttons 3 (up) / 4 (down)
    button = rawBtn === 64 ? 3 : 4;
    action = rawBtn === 64 ? 'wheel-up' : 'wheel-down';
  } else if (rawBtn >= 32) {
    // Drag (motion with button held)
    button = rawBtn & 0x1f;
    action = 'drag';
  } else {
    button = rawBtn;
    action = suffix === 'M' ? 'press' : 'release';
  }

  let stopped = false;

  return {
    button,
    x,
    y,
    action,
    stopImmediatePropagation() {
      stopped = true;
    },
    get propagationStopped() {
      return stopped;
    },
  };
}

function toMouseEventLite(ev: SgrMouseEvent): MouseEventLite {
  let stopCalled = false;
  return {
    button: ev.button,
    localCol: ev.x - 1,
    localRow: ev.y - 1,
    cellIsBlank: false,
    stopImmediatePropagation() {
      stopCalled = true;
      ev.stopImmediatePropagation();
    },
  };
}

// ---------------------------------------------------------------------------
// Escape sequences
// ---------------------------------------------------------------------------

const ENABLE_SGR = '\x1b[?1000;1006h';
const DISABLE_SGR = '\x1b[?1000;1006l';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * MouseProvider enables SGR extended mouse tracking and dispatches parsed
 * events to registered handlers.  Place this high in the component tree
 * (e.g. inside AlternateScreen or at the app root) so all mouse-aware
 * components receive events.
 */
export function MouseProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const handlersRef = useRef<Set<MouseEventHandler>>(new Set());
  const sgrActiveRef = useRef(false);
  const enableCountRef = useRef(0);

  const enableSgr = useCallback(() => {
    enableCountRef.current += 1;
    if (!sgrActiveRef.current && process.stdout.isTTY) {
      process.stdout.write(ENABLE_SGR);
      sgrActiveRef.current = true;
    }
  }, []);

  const disableSgr = useCallback(() => {
    enableCountRef.current = Math.max(0, enableCountRef.current - 1);
    if (enableCountRef.current === 0 && sgrActiveRef.current && process.stdout.isTTY) {
      process.stdout.write(DISABLE_SGR);
      sgrActiveRef.current = false;
    }
  }, []);

  // Ensure SGR is disabled when provider unmounts
  useEffect(() => {
    return () => {
      if (sgrActiveRef.current && process.stdout.isTTY) {
        process.stdout.write(DISABLE_SGR);
        sgrActiveRef.current = false;
      }
    };
  }, []);

  useInput((input: string) => {
    const ev = parseSgr(input);
    if (!ev) return;

    // Dispatch to all handlers; stopImmediatePropagation short-circuits
    for (const handler of handlersRef.current) {
      if (ev.propagationStopped) break;
      handler(ev);
    }
  });

  const registerHandler = useCallback(
    (handler: MouseEventHandler): (() => void) => {
      handlersRef.current.add(handler);
      enableSgr();
      return () => {
        handlersRef.current.delete(handler);
        disableSgr();
      };
    },
    [enableSgr, disableSgr],
  );

  const value = useMemo(
    (): MouseTrackerContextValue => ({ registerHandler }),
    [registerHandler],
  );

  return React.createElement(
    MouseTrackerContext.Provider,
    { value },
    children,
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook to access the mouse tracker context.  Must be called within a
 * `<MouseProvider>` ancestor.
 */
export function useMouseTracker(): MouseTrackerContextValue {
  const ctx = useContext(MouseTrackerContext);
  if (!ctx) {
    throw new Error(
      'useMouseTracker() must be used within a <MouseProvider>',
    );
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Utility: register mouse callbacks for a component
// ---------------------------------------------------------------------------

export interface MouseCallbacks {
  onClick?: (e: MouseEventLite) => void;
  onMouseDown?: (e: MouseEventLite) => void;
  onMouseUp?: (e: MouseEventLite) => void;
  onMouseDrag?: (e: MouseEventLite) => void;
  onMouseEnter?: (e: MouseEventLite) => void;
  onMouseLeave?: (e: MouseEventLite) => void;
}

/**
 * Registers mouse callbacks with the mouse tracker and returns a cleanup
 * function.  Designed to be called inside a useEffect.
 *
 * Mouse action → callback mapping:
 *   press   → onMouseDown (then onClick on release inside the same cell)
 *   drag    → onMouseDrag
 *   release → onMouseUp (then possibly onClick)
 *   wheel   → no default mapping (future use)
 */
export function createMouseHandler(
  tracker: MouseTrackerContextValue,
  callbacks: MouseCallbacks,
): () => void {
  // Track the last press position so we can emit onClick on release
  // at roughly the same coordinates.
  let lastPress: { x: number; y: number; button: number } | null = null;

  return tracker.registerHandler((ev: SgrMouseEvent) => {
    const lite = toMouseEventLite(ev);

    switch (ev.action) {
      case 'press': {
        lastPress = { x: ev.x, y: ev.y, button: ev.button };
        callbacks.onMouseDown?.(lite);
        break;
      }
      case 'drag': {
        callbacks.onMouseDrag?.(lite);
        break;
      }
      case 'release': {
        callbacks.onMouseUp?.(lite);
        // Emit onClick if the release is near the initial press
        if (
          lastPress &&
          lastPress.button === ev.button &&
          Math.abs(lastPress.x - ev.x) <= 1 &&
          Math.abs(lastPress.y - ev.y) <= 1
        ) {
          callbacks.onClick?.(lite);
        }
        lastPress = null;
        break;
      }
      // Wheel events not forwarded to component callbacks yet
      default:
        break;
    }
  });
}
