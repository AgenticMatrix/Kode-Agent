/**
 * useInput compat wrapper — Phase 2
 *
 * Wraps ink v7's useInput (which provides 2 args: input, key) to provide
 * a 3-argument handler (input, key, event) expected by CA's CLI code.
 *
 * The third argument is an InputEvent with a `keypress` property (raw string
 * + isPasted flag) that textInput.tsx and other CA components depend on.
 * Without this wrapper, `event` is `undefined` and any access to
 * `event.keypress` throws TypeError, crashing the React tree.
 *
 * ## SGR Mouse Filtering
 * SGR extended mouse escape sequences (CSI < btn ; x ; y M/m) arrive
 * through the same stdin stream as keyboard input when mouse tracking is
 * enabled.  The MouseProvider (which imports useInput directly from ink)
 * parses these into typed mouse events.  However, ink v7's useInput is
 * multicast — ALL handlers receive ALL input.  Without filtering, SGR
 * sequences leak into TextInput and appear as garbled text.
 *
 * We filter SGR sequences here so they never reach CA component handlers.
 * MouseProvider is unaffected because it imports useInput from ink directly.
 */
import { useInput as inkUseInput } from 'ink';
import type { Key as InkKey } from 'ink';
import { InputEvent, type Key } from './types.js';

type InputHandler = (input: string, key: Key, event: InputEvent) => void;

/** SGR extended mouse escape sequence: [< btn ; x ; y M/m  (ESC prefix stripped by ink v7) */
const SGR_MOUSE_RE = /^\[<(\d+);(\d+);(\d+)([Mm])$/;

/**
 * Wraps ink v7's 2-arg useInput to provide CA's 3-arg handler signature.
 *
 * For each input event, constructs an InputEvent with:
 *   - keypress.raw = input (the raw stdin string)
 *   - keypress.isPasted = false (bracketed paste detection deferred)
 *
 * SGR mouse escape sequences are silently dropped — they are consumed by
 * the MouseProvider (which uses ink's useInput directly) and should not
 * reach CA component handlers such as TextInput.
 */
export function useInput(inputHandler: InputHandler, options?: { isActive?: boolean }): void {
  inkUseInput((input: string, key: InkKey) => {
    // Drop SGR mouse escape sequences — they are handled by MouseProvider
    // which imports useInput directly from 'ink'.  Letting them through causes
    // garbled text in TextInput (e.g. "[<64;60;19M" on touch scroll).
    if (SGR_MOUSE_RE.test(input)) return;

    const event = new InputEvent(input, key as Key);
    inputHandler(input, key as Key, event);
  }, options as any);
}

export default useInput;
