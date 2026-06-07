/**
 * Type re-exports — Phase 0
 *
 * Compatible type definitions for CA-specific types that don't exist
 * in standard Ink. These ensure CLI code that imports types compiles.
 */

import type { Key as InkKey } from 'ink';

// ---------------------------------------------------------------------------
// Key (extended from ink — adds wheel events used by CA)
// ---------------------------------------------------------------------------

export interface Key extends InkKey {
  wheelUp: boolean;
  wheelDown: boolean;
}

// ---------------------------------------------------------------------------
// InputEvent (CA-specific — wraps a Key with metadata)
// ---------------------------------------------------------------------------

/** Keypress metadata object — CA treats keypress as an object, not a string */
export interface KeypressInfo {
  /** Raw input string from stdin */
  raw: string;
  /** Whether this input was pasted (bracketed paste mode) */
  isPasted: boolean;
}

export class InputEvent {
  /** The raw input string from stdin */
  readonly input: string;
  /** Parsed key information */
  readonly key: Key;
  /** Keypress metadata (raw string + paste detection) */
  readonly keypress: KeypressInfo;

  constructor(input: string, key: Key) {
    this.input = input;
    this.key = key;
    this.keypress = { raw: input, isPasted: false };
  }

  /** Prevent default behaviour */
  preventDefault(): void {
    // Phase 0 stub
  }
}

// ---------------------------------------------------------------------------
// FrameEvent (CA-specific — per-frame performance metrics)
// ---------------------------------------------------------------------------

/** Named phases within a render frame — CA treats phases as an object */
export interface FramePhases {
  commit: number;
  diff: number;
  optimize: number;
  prevFrameDrainMs: number;
  renderer: number;
  write: number;
  yoga: number;
  [key: string]: number;
}

export interface FrameEvent {
  /** Total frame time in milliseconds */
  totalTime: number;
  /** Alias for totalTime — used by CLI perf code */
  durationMs: number;
  /** Per-phase timing breakdown (named object, not array) */
  phases: FramePhases;
  /** Number of cells changed this frame */
  patchCount: number;
  /** Array of flicker events detected this frame */
  flickers: unknown[];
  /** True if flicker was detected */
  flicker: boolean;
  /** True if this was a full reset (causes visible flash) */
  fullReset: boolean;
}

// ---------------------------------------------------------------------------
// MouseTrackingMode (re-exported from alt-screen for compatibility)
// ---------------------------------------------------------------------------
export type { MouseTrackingMode } from './alternate-screen.js';
