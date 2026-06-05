/**
 * @coder/tui entry exports — Phase 0b (InkWrapper adapter)
 *
 * All public API re-exports. Sources:
 *   - Ink v7 npm (Box, Text, Newline, Spacer, hooks, render, measureElement)
 *   - ink-link (Link)
 *   - string-width / wrap-ansi (utility replacements)
 *   - compat/ (stub implementations for CA-specific features)
 *   - CA hooks/ (useStderr, useStdout — business-layer hooks)
 *   - ink-text-input (TextInput, UncontrolledTextInput)
 *
 * Every export that existed before the vendored-ink removal MUST be present
 * with the same name, same type, so CLI code needs zero import changes.
 *
 * Original export list (34 exports from CA entry-exports.ts):
 *   useStderr, useStdout, Ansi, evictInkCaches, EvictLevel, InkCacheSizes,
 *   AlternateScreen, Box, Link, Newline, NoSelect, RawAnsi,
 *   ScrollBox, ScrollBoxHandle, ScrollBoxProps, Spacer, Text,
 *   useApp, useCursorAdvance, useDeclaredCursor,
 *   useExternalProcess, withInkSuspended, RunExternalProcess,
 *   useInput, useHasSelection, useSelection, useStdin, useTabStatus,
 *   useTerminalFocus, useTerminalTitle, useTerminalViewport,
 *   measureElement, scrollFastPathStats, ScrollFastPathStats,
 *   createRoot, forceRedraw, render, renderSync,
 *   stringWidth, wrapAnsi, isXtermJs,
 *   FrameEvent, InputEvent, Key, MouseTrackingMode,
 *   TextInput, UncontrolledTextInput
 */

// =========================================================================
// 1. Components — CA compat wrappers (accept CA-specific props like onClick, dim)
// =========================================================================

export { default as Box } from './compat/box.js';
export type { BoxProps } from './compat/box.js';

export { default as Text } from './compat/text.js';
export type { TextProps } from './compat/text.js';

// Standard components from ink v7 (no CA extensions needed)
export { Newline, Spacer } from 'ink';

// =========================================================================
// 2. Components — from ink-link
// =========================================================================

export { default as Link } from 'ink-link';

// =========================================================================
// 3. Components — CA compat stubs
// =========================================================================

export { Ansi } from './compat/ansi.js';
export { RawAnsi } from './compat/raw-ansi.js';
export { NoSelect } from './compat/no-select.js';
export { AlternateScreen } from './compat/alternate-screen.js';
export {
  default as ScrollBox,
  type ScrollBoxHandle,
  type ScrollBoxProps,
} from './compat/scroll-box.js';

// =========================================================================
// 4. Hooks — direct from ink v7 npm
//    (These were originally from ./ink/hooks/ in the vendored Ink)
// =========================================================================

export { useApp } from 'ink';
export { useStdin } from './compat/use-stdin.js';
export { useInput } from './compat/use-input.js';

// =========================================================================
// 5. Hooks — CA business layer (via existing hooks/)
//    (CA's own useStdout/useStderr wrap process.stdio directly.
//     These are DIFFERENT from ink's useStdout/useStderr)
// =========================================================================

export { default as useStderr } from './hooks/use-stderr.js';
export type { StderrHandle } from './hooks/use-stderr.js';

export { default as useStdout } from './hooks/use-stdout.js';
export type { StdoutHandle } from './hooks/use-stdout.js';

// =========================================================================
// 6. Hooks — CA compat stubs
// =========================================================================

export { useTerminalTitle } from './compat/terminal-title.js';
export {
  useHasSelection,
  useSelection,
  type SelectionHandle,
  type SelectionState,
} from './compat/selection.js';
export {
  useExternalProcess,
  withInkSuspended,
  type RunExternalProcess,
} from './compat/external-process.js';
export { useCursorAdvance, useDeclaredCursor } from './compat/cursor-hooks.js';
export type {
  CursorAdvanceHandle,
  DeclaredCursorHandle,
} from './compat/cursor-hooks.js';
export { useTerminalFocus } from './compat/terminal-focus.js';
export { useTerminalViewport } from './compat/terminal-viewport.js';
export type { ViewportState } from './compat/terminal-viewport.js';
export { useTabStatus } from './compat/tab-status.js';
export type { TabStatus } from './compat/tab-status.js';

// =========================================================================
// 7. Utilities — from npm packages (wrapped for API compatibility)
// =========================================================================

import stringWidthNpm from 'string-width';
/**
 * Get the visual width of a string — the number of columns required to
 * display it in the terminal.
 *
 * Wraps `string-width` npm package to match the original CA `stringWidth`
 * API: single argument, default options.
 */
export function stringWidth(str: string): number {
  return stringWidthNpm(str);
}

import wrapAnsiNpm from 'wrap-ansi';
/**
 * Wrap text to the specified column width, preserving ANSI escape codes.
 * Newline characters are normalized to `\n`.
 *
 * Wraps `wrap-ansi` npm package to match the original CA `wrapAnsi`
 * API: (text, columns) with default options.
 */
export function wrapAnsi(text: string, columns: number): string {
  return wrapAnsiNpm(text, columns);
}

// =========================================================================
// 8. Utilities — from ink v7 npm
// =========================================================================

export { measureElement } from 'ink';

// =========================================================================
// 9. Render — from ink + CA compat
// =========================================================================

// Standard Ink render — the original CA entry-exports had:
//   export { createRoot, forceRedraw, default as render, renderSync } from './ink/root.js'
// Ink v7 does NOT export unmount as standalone (it's a method on the Instance).
export { render } from 'ink';

// CA-specific render extensions
export { forceRedraw } from './compat/force-redraw.js';
export {
  renderSync,
  createRoot,
} from './compat/render-utils.js';

// =========================================================================
// 10. Utilities — CA compat stubs
// =========================================================================

export { isXtermJs } from './compat/terminal-detect.js';
export {
  scrollFastPathStats,
  type ScrollFastPathStats,
} from './compat/scroll-stats.js';
export {
  evictInkCaches,
  type EvictLevel,
  type InkCacheSizes,
} from './compat/cache-eviction.js';

// =========================================================================
// 11. Types — compat types + ink re-exports
// =========================================================================

export type { Key } from './compat/types.js';
export { InputEvent } from './compat/types.js';
export type { FrameEvent, FramePhases } from './compat/types.js';
export type { MouseTrackingMode } from './compat/types.js';

// =========================================================================
// 12. TextInput — from ink-text-input
// =========================================================================

export { default as TextInput, UncontrolledTextInput } from 'ink-text-input';
