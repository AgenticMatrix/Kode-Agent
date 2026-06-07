/**
 * AlternateScreen — Phase 1.3
 *
 * Manages the terminal alternate screen buffer (DEC 1049) and SGR mouse
 * tracking via the `mouseTracking` prop.  Wraps children in MouseProvider
 * so descendant Box / ScrollBox / NoSelect components receive SGR mouse
 * events.
 *
 * ## Terminal protocol
 *
 *   CSI ? 1049 h      — enter alternate screen (saves cursor + buffer)
 *   CSI ? 1049 l      — exit alternate screen (restores cursor + buffer)
 *   CSI 2 J           — erase entire display
 *   CSI H             — cursor to home (row 1, column 1)
 *
 * Mouse tracking (DECSET / DECRST):
 *   CSI ? 1000 h      — basic mouse tracking (press / release / wheel)
 *   CSI ? 1003 h      — any-event tracking (all motion)
 *   CSI ? 1006 h      — SGR extended coordinates
 *
 * All escape sequences are guarded by `process.stdout.isTTY` so the
 * component is a no-op when piped or running in CI.
 */
import React, { useEffect, useRef } from 'react';
import { Box } from 'ink';
import { MouseProvider } from './mouse-tracker.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type MouseTrackingMode = 'off' | 'wheel' | 'buttons' | 'all';

export interface AlternateScreenProps {
  children?: React.ReactNode;
  /** Mouse tracking mode in the alt-screen */
  mouseTracking?: MouseTrackingMode;
  /** Additional props forwarded to the underlying Box */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// ANSI escape sequences
// ---------------------------------------------------------------------------

const ENTER_ALT_SCREEN = '\x1b[?1049h';
const EXIT_ALT_SCREEN  = '\x1b[?1049l';
const CLEAR_DISPLAY    = '\x1b[2J\x1b[H';

// Mouse tracking — the raw CSI ? … h / l strings keyed by mode.
// SGR coords (1006) are always enabled when tracking is on so the
// MouseProvider can parse button + position from every event.
const MOUSE_DISABLE = '\x1b[?1000;1002;1003;1006l';

const SGR_BY_MODE: Record<MouseTrackingMode, string> = {
  off:     MOUSE_DISABLE,
  wheel:   '\x1b[?1000;1006h',            // basic + SGR  (wheel included)
  buttons: '\x1b[?1000;1006h',            // basic + SGR
  all:     '\x1b[?1000;1003;1006h',       // all-motion + SGR
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
 * AlternateScreen component.
 *
 * On mount:
 *   1. Enters the terminal alternate screen buffer (DEC 1049).
 *   2. Clears the alternate screen.
 *   3. Configures SGR mouse tracking according to `mouseTracking`.
 *
 * On unmount:
 *   1. Disables all mouse tracking.
 *   2. Exits the alternate screen buffer, restoring the main screen.
 *
 * When `mouseTracking` changes at runtime the SGR state is updated
 * without re-entering the alternate buffer.
 */
export function AlternateScreen({
  children,
  mouseTracking = 'off',
  ...rest
}: AlternateScreenProps): React.ReactElement {
  // Track the current SGR mode so we only emit deltas.
  const sgrRef = useRef<MouseTrackingMode>('off');

  // ── Mount: enter alt screen + clear + mouse tracking ──────────
  useEffect(() => {
    write(ENTER_ALT_SCREEN);
    write(CLEAR_DISPLAY);

    const sgr = SGR_BY_MODE[mouseTracking];
    if (sgr) write(sgr);
    sgrRef.current = mouseTracking;

    // ── Unmount: disable mouse + exit alt screen ─────────────────
    return () => {
      write(MOUSE_DISABLE);
      write(EXIT_ALT_SCREEN);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // ^^ intentional: mount/unmount only — tracking changes handled below.

  // ── Runtime: update SGR when mouseTracking prop changes ────────
  useEffect(() => {
    if (mouseTracking === sgrRef.current) return;

    // Disable previous SGR state first, then enable the new one.
    // This avoids leaving stale modes on when transitioning between
    // tracking configurations.
    write(MOUSE_DISABLE);

    const sgr = SGR_BY_MODE[mouseTracking];
    if (sgr) write(sgr);
    sgrRef.current = mouseTracking;
  }, [mouseTracking]);

  // ── Render ─────────────────────────────────────────────────────
  // Use a numeric height (terminal rows) instead of "100%" because
  // Ink v7's calculateLayout only sets the root Yoga node's WIDTH,
  // never the HEIGHT.  With an auto-height root, `height="100%"` on
  // a child resolves to content-height (auto), causing `flexGrow`
  // children to collapse and the first render to be non-fullscreen.
  // Non-fullscreen output gets a trailing newline in
  // renderInteractiveFrame, which shifts log-update's cursor suffix
  // one row too low (see cursor-hooks.ts for the coordinate fix).
  // Setting an explicit height ensures outputHeight >= viewportRows
  // from the very first frame, keeping the cursor correctly positioned.
  const rows = process.stdout?.rows ?? 24;
  return (
    <MouseProvider>
      <Box flexDirection="column" height={rows} {...rest}>
        {children}
      </Box>
    </MouseProvider>
  );
}

export default AlternateScreen;
