/**
 * MainScreen — Phase 2.0
 *
 * Replaces AlternateScreen for main-screen (non-DEC-1049) rendering.
 * Manages SGR mouse tracking via the `mouseTracking` prop and wraps
 * children in MouseProvider so descendant Box / ScrollBox / NoSelect
 * components receive SGR mouse events.
 *
 * Unlike AlternateScreen, this component does NOT:
 *   - Enter/exit the alternate screen buffer (no DEC 1049)
 *   - Clear the display on mount
 *   - Set an explicit height on the root Box
 *
 * This allows terminal native scrollback to capture history content,
 * and Ink's Yoga auto-height to determine the layout naturally.
 *
 * ## Terminal protocol
 *
 * Mouse tracking (DECSET / DECRST):
 *   CSI ? 1000 h      — basic mouse tracking (press / release / wheel)
 *   CSI ? 1003 h      — any-event tracking (all motion)
 *   CSI ? 1006 h      — SGR extended coordinates
 *
 * All escape sequences are guarded by `process.stdout.isTTY`.
 */
import React, { useEffect, useRef } from 'react';
import { Box } from 'ink';
import { MouseProvider } from './mouse-tracker.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type MouseTrackingMode = 'off' | 'wheel' | 'buttons' | 'all';

export interface MainScreenProps {
  children?: React.ReactNode;
  /** Mouse tracking mode */
  mouseTracking?: MouseTrackingMode;
  /** Additional props forwarded to the underlying Box */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// ANSI escape sequences
// ---------------------------------------------------------------------------

// Mouse tracking — the raw CSI ? … h / l strings keyed by mode.
const MOUSE_DISABLE = '\x1b[?1000;1002;1003;1006l';

const SGR_BY_MODE: Record<MouseTrackingMode, string> = {
  off:     MOUSE_DISABLE,
  wheel:   '\x1b[?1000;1006h',
  buttons: '\x1b[?1000;1006h',
  all:     '\x1b[?1000;1003;1006h',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTTY(): boolean {
  return !!(process.stdout.isTTY);
}

function write(ansi: string): void {
  if (isTTY()) {
    process.stdout.write(ansi);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * MainScreen component.
 *
 * On mount:
 *   1. Configures SGR mouse tracking according to `mouseTracking`.
 *
 * On unmount:
 *   1. Disables all mouse tracking.
 *
 * When `mouseTracking` changes at runtime the SGR state is updated
 * without re-entering the alternate buffer.
 */
export function MainScreen({
  children,
  mouseTracking = 'off',
  ...rest
}: MainScreenProps): React.ReactElement {
  const sgrRef = useRef<MouseTrackingMode>('off');

  // ── Mount: mouse tracking ──────────────────────────────────────
  useEffect(() => {
    const sgr = SGR_BY_MODE[mouseTracking];
    if (sgr) write(sgr);
    sgrRef.current = mouseTracking;

    // ── Unmount: disable mouse ────────────────────────────────────
    return () => {
      write(MOUSE_DISABLE);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Runtime: update SGR when mouseTracking prop changes ─────────
  useEffect(() => {
    if (mouseTracking === sgrRef.current) return;

    write(MOUSE_DISABLE);

    const sgr = SGR_BY_MODE[mouseTracking];
    if (sgr) write(sgr);
    sgrRef.current = mouseTracking;
  }, [mouseTracking]);

  // ── Render ─────────────────────────────────────────────────────
  // Auto-height: without alternate screen, Yoga determines the
  // natural content height. This lets terminal scrollback capture
  // content that scrolls off the top.
  return (
    <MouseProvider>
      <Box flexDirection="column" {...rest}>
        {children}
      </Box>
    </MouseProvider>
  );
}

export default MainScreen;
