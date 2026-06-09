import { useInput } from 'ink';

import type { Message, ChatAction } from '../../types.js';
import { expandPasteMarkers } from './useChatReducer.js';

export interface InputHandlerDeps {
  inputText: string;
  cursorPosition: number;
  isStreaming: boolean;
  messages: Message[];
  dispatch: React.Dispatch<ChatAction>;
  onSend: (text: string) => void;
  /** When true, input is suppressed (e.g. during approval prompt). */
  blocked?: boolean;
  /** Optional slash command handler. Returns true if the command was handled. */
  onSlashCommand?: (input: string) => boolean;
  /** Input history lines (newest last). */
  history: string[];
  /** Current position in history (-1 = not browsing). */
  historyIndex: number;
  /** Saved input before entering history browse mode. */
  historyScratch: string;
  /** Paste block contents for expanding markers before send. */
  pasteBlocks: Record<number, string>;
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
  blocked,
  history,
  historyIndex,
  historyScratch,
  pasteBlocks,
}: InputHandlerDeps) {
  useInput(
    (input, key) => {
      // When an approval overlay is active, suppress normal input.
      // The ApprovalPrompt component handles its own input.
      if (blocked) return;

      if (key.escape) {
        dispatch({ type: 'SET_INPUT', text: '' });
        dispatch({ type: 'SET_HISTORY_INDEX', index: -1 });
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
          // Expand paste markers to full text before sending / saving history
          const expandedText = expandPasteMarkers(inputText.trim(), pasteBlocks);
          dispatch({ type: 'ADD_HISTORY', line: expandedText });
          dispatch({ type: 'SET_HISTORY_INDEX', index: -1 });
          // Check for slash commands first
          if (inputText.startsWith('/') && onSlashCommand?.(inputText)) {
            dispatch({ type: 'SET_INPUT', text: '' });
          } else {
            onSend(expandedText);
          }
        }
        return;
      }

      // ── History navigation (up / down arrows) ──────────────────
      if (key.upArrow) {
        if (history.length === 0) return;
        if (historyIndex === -1) {
          // Enter history browse mode — save current input as scratch
          const newIdx = history.length - 1;
          dispatch({ type: 'SET_HISTORY_INDEX', index: newIdx, scratch: inputText });
          dispatch({ type: 'SET_INPUT', text: history[newIdx]! });
          dispatch({ type: 'SET_CURSOR', position: history[newIdx]!.length });
          return;
        }
        if (historyIndex > 0) {
          const newIdx = historyIndex - 1;
          dispatch({ type: 'SET_HISTORY_INDEX', index: newIdx });
          dispatch({ type: 'SET_INPUT', text: history[newIdx]! });
          dispatch({ type: 'SET_CURSOR', position: history[newIdx]!.length });
        }
        return;
      }

      if (key.downArrow) {
        if (historyIndex === -1) return;
        if (historyIndex < history.length - 1) {
          const newIdx = historyIndex + 1;
          dispatch({ type: 'SET_HISTORY_INDEX', index: newIdx });
          dispatch({ type: 'SET_INPUT', text: history[newIdx]! });
          dispatch({ type: 'SET_CURSOR', position: history[newIdx]!.length });
        } else {
          // At the last entry — exit history, restore scratch
          dispatch({ type: 'SET_HISTORY_INDEX', index: -1 });
          dispatch({ type: 'SET_INPUT', text: historyScratch });
          dispatch({ type: 'SET_CURSOR', position: historyScratch.length });
        }
        return;
      }

      // Any other key press exits history browse mode
      if (historyIndex >= 0) {
        dispatch({ type: 'SET_HISTORY_INDEX', index: -1 });
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

      // Multi-line input → paste block (marker placeholder + stored content)
      if (input.includes('\n') || input.includes('\r')) {
        dispatch({ type: 'ADD_PASTE_BLOCK', text: input });
        return;
      }

      // Insert character at cursor position
      dispatch({ type: 'INSERT_CHAR', char: input });
    },
    { isActive: true },
  );
}
