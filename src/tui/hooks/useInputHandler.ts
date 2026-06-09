import { useInput } from 'ink';

import type { Message, ChatAction } from '../../types.js';

export interface InputHandlerDeps {
  inputText: string;
  cursorPosition: number;
  isStreaming: boolean;
  messages: Message[];
  dispatch: React.Dispatch<ChatAction>;
  onSend: (text: string) => void;
  /** Optional slash command handler. Returns true if the command was handled. */
  onSlashCommand?: (input: string) => boolean;
}

/**
 * Hook that handles all keyboard input via Ink's useInput.
 *
 * Keys:
 *   Enter       — send message
 *   Escape      — clear input
 *   Ctrl+E      — toggle thinking of last assistant message
 *   ← → Home End — cursor movement
 *   Backspace/Del — deletion
 *   Printable   — insert at cursor
 */
export function useInputHandler({
  inputText,
  cursorPosition: _cp,
  isStreaming,
  messages,
  dispatch,
  onSend,
  onSlashCommand,
}: InputHandlerDeps) {
  useInput(
    (input, key) => {
      if (key.escape) {
        dispatch({ type: 'SET_INPUT', text: '' });
        return;
      }

      // Ctrl+E toggles thinking expansion of the last assistant message
      if (key.ctrl && input === 'e') {
        const lastAssistant = [...messages]
          .reverse()
          .find((m) => m.role === 'assistant' && (m.thinking || m.blocks.some(b => b.type === 'thinking')));
        if (lastAssistant) {
          dispatch({ type: 'TOGGLE_THINKING', id: lastAssistant.id });
        }
        return;
      }

      if (key.return) {
        if (inputText.trim().length > 0) {
          // Check for slash commands first
          if (inputText.startsWith('/') && onSlashCommand?.(inputText)) {
            dispatch({ type: 'SET_INPUT', text: '' });
          } else {
            onSend(inputText);
          }
        }
        return;
      }

      // ── Cursor movement ────────────────────────────────────────
      if (key.leftArrow) {
        dispatch({
          type: 'SET_CURSOR',
          position: _cp - 1,
        });
        return;
      }
      if (key.rightArrow) {
        dispatch({
          type: 'SET_CURSOR',
          position: _cp + 1,
        });
        return;
      }
      if (key.home) {
        dispatch({ type: 'SET_CURSOR', position: 0 });
        return;
      }
      if (key.end) {
        dispatch({ type: 'SET_CURSOR', position: inputText.length });
        return;
      }

      // ── Deletion ───────────────────────────────────────────────
      if (key.backspace) {
        dispatch({ type: 'DELETE_CHAR', position: 'before' });
        return;
      }
      if (key.delete) {
        dispatch({ type: 'DELETE_CHAR', position: 'after' });
        return;
      }

      // Ignore non-printable characters
      if (!input || input.length === 0) return;

      // Prevent typing while streaming
      if (isStreaming) return;

      // Insert character at cursor position
      dispatch({ type: 'INSERT_CHAR', char: input });
    },
    { isActive: true },
  );
}
