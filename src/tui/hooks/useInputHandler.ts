import { useInput } from 'ink';

import type { Message, ChatAction } from '../../types.js';
import { expandPasteMarkers } from './useChatReducer.js';
import { getSubAgentRegistry } from '../../agents/agent-spawn/registry-ref.js';

export interface InputHandlerDeps {
  inputText: string;
  cursorPosition: number;
  isStreaming: boolean;
  messages: Message[];
  dispatch: React.Dispatch<ChatAction>;
  onSend: (text: string) => void;
  /** Interrupt the running main agent. */
  onInterrupt: () => void;
  /** Exit the process. */
  onExit: () => void;
  /** When true, input is suppressed (e.g. during approval prompt). */
  blocked?: boolean;
  /** When true, the team picker overlay is shown. */
  teamPicker?: boolean;
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
  /** Current sub-agent view state (null = main chat). */
  subAgentView?: { agentId: string } | null;
  /** Last viewed sub-agent ID — Ctrl+T defaults to this. */
  lastAgentViewId?: string | null;
}

/**
 * Hook that handles all keyboard input via Ink's useInput.
 *
 * Keys:
 *   Enter       — send message
 *   Escape      — clear input
 *   Ctrl+E      — toggle expand / collapse tool blocks
   Ctrl+D      — toggle expand / collapse block content (thinking, etc.)
   Ctrl+T      — view sub-agent transcript
   Ctrl+P      — toggle task panel
   Ctrl+K      — toggle team picker
   Esc         — close sub-agent view / clear input
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
  onInterrupt,
  onExit,
  onSlashCommand,
  blocked,
  history,
  historyIndex,
  historyScratch,
  pasteBlocks,
  subAgentView,
  lastAgentViewId,
  teamPicker,
}: InputHandlerDeps) {
  useInput(
    (input, key) => {
      // ── Ctrl+C: smart 3-tier exit ──────────────────────────
      if ((key.ctrl && (input === 'c' || input === '\x03')) || input === '\x03') {
        // Tier 1: main agent running → interrupt it
        if (isStreaming) {
          onInterrupt();
          dispatch({ type: 'INTERRUPT' });
          return;
        }
        // Tier 2: input has text → clear it
        if (inputText.length > 0) {
          dispatch({ type: 'SET_INPUT', text: '' });
          dispatch({ type: 'SET_HISTORY_INDEX', index: -1 });
          return;
        }
        // Tier 3: agent not running, input empty → exit
        onExit();
        return;
      }
      // Always allow Escape and Ctrl+T (for navigating sub-agent views)
      if (key.escape) {
        if (subAgentView) {
          dispatch({ type: 'CLOSE_SUBAGENT_VIEW' });
          return;
        }
        if (blocked) return;
        dispatch({ type: 'SET_INPUT', text: '' });
        dispatch({ type: 'SET_HISTORY_INDEX', index: -1 });
        return;
      }

      // Ctrl+T toggles sub-agent transcript view
      if (key.ctrl && input === 't') {
        if (subAgentView) {
          dispatch({ type: 'CLOSE_SUBAGENT_VIEW' });
          return;
        }
        const registry = getSubAgentRegistry();
        if (registry) {
          const allAgents = registry.list();
          if (allAgents.length === 0) return;

          // Prefer last viewed agent if still in registry
          if (lastAgentViewId && registry.get(lastAgentViewId)) {
            dispatch({ type: 'OPEN_SUBAGENT_VIEW', agentId: lastAgentViewId });
            return;
          }

          // Default: most recently created agent in the full list
          const latest = allAgents.reduce((a, b) =>
            a.createdAt > b.createdAt ? a : b,
          );
          dispatch({ type: 'OPEN_SUBAGENT_VIEW', agentId: latest.id });
        }
        return;
      }

      // Ctrl+P toggles task panel
      if (key.ctrl && input === 'p') {
        dispatch({ type: 'TOGGLE_TASK_PANEL' });
        return;
      }

      // Ctrl+K opens team member picker overlay
      if (key.ctrl && input === 'k') {
        if (teamPicker) {
          dispatch({ type: 'HIDE_TEAM_PICKER' });
        } else {
          dispatch({ type: 'SHOW_TEAM_PICKER' });
        }
        return;
      }

      // When team picker is shown, suppress all other input
      // (the TeamAgentPicker component handles arrow keys / Enter)
      if (teamPicker) return;

      // When an approval overlay is active, suppress normal input.
      if (blocked) return;

      // ── Display freeze (scroll-away) controls ─────────────────
      // PageUp  → freeze display (enter review mode)
      // PageDown / End → unfreeze (resume following)
      // These work even when not streaming, to be safe.
      if (key.pageUp) {
        dispatch({ type: 'FREEZE_DISPLAY' });
        return;
      }
      if (key.pageDown || key.end) {
        dispatch({ type: 'UNFREEZE_DISPLAY' });
        return;
      }

      // Allow sending messages while viewing a sub-agent transcript.
      // The view closes and the message goes to the main agent.
      if (subAgentView && key.return) {
        dispatch({ type: 'CLOSE_SUBAGENT_VIEW' });
        // Fall through to normal send logic below
      }

      // Ctrl+E toggles expand / collapse of tool blocks
      if (key.ctrl && input === 'e') {
        dispatch({ type: 'TOGGLE_ALL_EXPAND' });
        return;
      }

      // Ctrl+D toggles expand / collapse of block content (thinking, etc.)
      if (key.ctrl && input === 'd') {
        dispatch({ type: 'TOGGLE_ALL_CONTENT' });
        return;
      }

      if (key.return) {
        if (inputText.trim().length > 0) {
          // Auto-resume following when user sends a message
          dispatch({ type: 'UNFREEZE_DISPLAY' });
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
