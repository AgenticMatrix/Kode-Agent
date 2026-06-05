/**
 * useInput compat wrapper — Phase 0
 *
 * Wraps ink's useInput to extend the returned Key type with CA-specific
 * properties (wheelUp, wheelDown) used by the CLI input handlers.
 * Also supports 3-argument handlers used by textInput.tsx where the third
 * argument is an InputEvent.
 */
import { useInput as inkUseInput } from 'ink';
import type { Key, InputEvent } from './types.js';

type InputHandler = (input: string, key: Key, event: InputEvent) => void;

/**
 * Wraps ink's useInput hook with extended Key type support and 3-arg handler.
 * Phase 0: casts the key to our extended Key type. 3-arg handlers are supported
 * via cast to match ink's 2-arg handler signature.
 */
export function useInput(inputHandler: InputHandler, options?: { isActive?: boolean }): void {
  inkUseInput(inputHandler as any, options as any);
}

export default useInput;
