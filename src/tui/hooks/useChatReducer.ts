import { useReducer } from 'react';

import type {
  ChatState, ChatAction, Message, ContentBlock,
  TextBlock, ThinkingBlock,
} from '../../types.js';

let messageIdCounter = 0;
export function nextMessageId(): number {
  return messageIdCounter++;
}

/** Get plain text from Message.blocks for backward compat. */
export function getMessageText(m: Message): string {
  if (m.blocks.length > 0) {
    return m.blocks
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.content)
      .join('');
  }
  return m.content;
}

/** Get thinking text from Message.blocks. */
export function getMessageThinking(m: Message): string | undefined {
  const thinkingBlock = m.blocks.find(
    (b): b is ThinkingBlock => b.type === 'thinking',
  );
  if (thinkingBlock) return thinkingBlock.content;
  return m.thinking;
}

// ── Reducer ─────────────────────────────────────────────────────────────

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SET_INPUT':
      return {
        ...state,
        inputText: action.text,
        cursorPosition: action.text.length,
        pasteBlocks: action.text === '' ? {} : state.pasteBlocks,
      };

    case 'ADD_USER_MESSAGE':
      return {
        ...state,
        messages: [...state.messages, action.message],
        inputText: '',
        cursorPosition: 0,
        error: null,
        pasteBlocks: {},
      };

    case 'START_ASSISTANT_RESPONSE': {
      const assistantMsg: Message = {
        id: action.id,
        role: 'assistant',
        content: '',
        blocks: [],
        timestamp: Date.now(),
      };
      return {
        ...state,
        messages: [...state.messages, assistantMsg],
        isStreaming: true,
        currentTurnId: state.currentTurnId + 1,
      };
    }

    case 'START_BLOCK':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.messageId
            ? {
                ...m,
                blocks: [...m.blocks, action.block],
                content: getMessageText({
                  ...m,
                  blocks: [...m.blocks, action.block],
                }),
                thinking: getMessageThinking({
                  ...m,
                  blocks: [...m.blocks, action.block],
                }),
              }
            : m,
        ),
      };

    case 'APPEND_BLOCK_DELTA':
      return {
        ...state,
        messages: state.messages.map((m) => {
          if (m.id !== action.messageId) return m;

          if (m.blocks.length === 0) {
            const newBlock: ContentBlock =
              action.deltaType === 'thinking'
                ? { type: 'thinking', content: action.text } satisfies ThinkingBlock
                : { type: 'text', content: action.deltaType === 'text' ? action.text : '' };
            return {
              ...m,
              blocks: [newBlock],
              content: action.deltaType === 'text' ? action.text : m.content,
              thinking: action.deltaType === 'thinking' ? action.text : m.thinking,
            };
          }

          const blocks = [...m.blocks];
          const lastIdx = blocks.length - 1;
          const lastBlock = { ...blocks[lastIdx] };

          if (action.deltaType === 'text' && lastBlock.type === 'text') {
            (lastBlock as TextBlock).content += action.text;
          } else if (action.deltaType === 'thinking') {
            if (lastBlock.type === 'thinking') {
              (lastBlock as ThinkingBlock).content += action.text;
            } else {
              blocks.push({
                type: 'thinking',
                content: action.text,
              } satisfies ThinkingBlock);
              return {
                ...m,
                blocks,
                content: getMessageText({ ...m, blocks }),
                thinking: getMessageThinking({ ...m, blocks }),
              };
            }
          } else if (action.deltaType === 'json' && lastBlock.type === 'tool_use') {
            const partialStr = ((lastBlock.input as Record<string, unknown>)._partial as string || '') + action.text;
            // Try to parse the accumulated JSON so keys like `command` and `description`
            // are directly accessible to renderers during streaming.
            try {
              const parsed = JSON.parse(partialStr) as Record<string, unknown>;
              lastBlock.input = { ...parsed, _partial: partialStr };
            } catch {
              lastBlock.input = {
                ...lastBlock.input,
                _partial: partialStr,
              };
            }
          }

          blocks[lastIdx] = lastBlock;
          return {
            ...m,
            blocks,
            content: getMessageText({ ...m, blocks }),
            thinking: getMessageThinking({ ...m, blocks }),
          };
        }),
      };

    case 'SET_TOOL_USE_RESULT':
      return {
        ...state,
        messages: state.messages.map((m) => ({
          ...m,
          blocks: m.blocks.map((b) =>
            b.type === 'tool_use' && b.toolId === action.toolId
              ? {
                  ...b,
                  state: 'done' as const,
                  duration: action.duration,
                  result: action.result,
                }
              : b,
          ),
        })),
      };

    case 'STOP_BLOCK':
      return {
        ...state,
        messages: state.messages.map((m) => {
          if (m.id !== action.messageId || m.blocks.length === 0) return m;
          const blocks = [...m.blocks];
          const lastIdx = blocks.length - 1;
          const lastBlock = { ...blocks[lastIdx] };

          if (lastBlock.type === 'tool_use') {
            const partial = (lastBlock.input as Record<string, unknown>)._partial as string;
            if (partial) {
              try {
                lastBlock.input = JSON.parse(partial);
              } catch {
                lastBlock.input = { _raw: partial };
              }
            }
          }
          blocks[lastIdx] = lastBlock;
          return { ...m, blocks };
        }),
      };

    case 'APPEND_ASSISTANT_TEXT':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.id
            ? { ...m, content: m.content + action.text }
            : m,
        ),
      };

    case 'APPEND_ASSISTANT_THINKING':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.id
            ? { ...m, thinking: (m.thinking ?? '') + action.text }
            : m,
        ),
      };

    case 'UPDATE_BLOCK_STATE':
      return {
        ...state,
        messages: state.messages.map((m) => ({
          ...m,
          blocks: m.blocks.map((b) =>
            b.type === 'tool_use' && b.toolId === action.toolId
              ? { ...b, state: action.state }
              : b,
          ),
        })),
      };

    case 'FINISH_ASSISTANT_RESPONSE':
      return { ...state, isStreaming: false };

    case 'TOGGLE_THINKING':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.id
            ? { ...m, thinkingExpanded: !m.thinkingExpanded }
            : m,
        ),
      };

    case 'SET_MODE':
      return { ...state, mode: action.mode };

    case 'SET_CURSOR':
      return {
        ...state,
        cursorPosition: Math.max(0, Math.min(action.position, state.inputText.length)),
      };

    case 'INSERT_CHAR': {
      const pos = Math.max(0, Math.min(state.cursorPosition, state.inputText.length));
      const newText =
        state.inputText.slice(0, pos) +
        action.char +
        state.inputText.slice(pos);
      return {
        ...state,
        inputText: newText,
        cursorPosition: pos + action.char.length,
      };
    }

    case 'DELETE_CHAR': {
      const cp = Math.max(0, Math.min(state.cursorPosition, state.inputText.length));
      if (action.position === 'before') {
        if (cp === 0) return state;
        const newText =
          state.inputText.slice(0, cp - 1) + state.inputText.slice(cp);
        return {
          ...state,
          inputText: newText,
          cursorPosition: cp - 1,
        };
      } else {
        if (cp >= state.inputText.length) return state;
        const newText =
          state.inputText.slice(0, cp) + state.inputText.slice(cp + 1);
        return {
          ...state,
          inputText: newText,
          cursorPosition: cp,
        };
      }
    }

    case 'SET_ERROR':
      return { ...state, error: action.error, isStreaming: false };

    case 'CLEAR_ERROR':
      return { ...state, error: null };

    case 'CLEAR_CHAT':
      return { ...state, messages: [] };

    case 'SHOW_APPROVAL':
      return { ...state, approvalReq: action.req };

    case 'HIDE_APPROVAL':
      return { ...state, approvalReq: null };

    case 'LOAD_HISTORY':
      return { ...state, history: action.history };

    case 'ADD_HISTORY': {
      const trimmed = action.line.trim();
      if (trimmed.length === 0) return state;
      const prev = state.history;
      if (prev.length > 0 && prev[prev.length - 1] === trimmed) return state;
      return { ...state, history: [...prev, trimmed] };
    }

    case 'SET_HISTORY_INDEX':
      return {
        ...state,
        historyIndex: action.index,
        historyScratch: action.scratch !== undefined ? action.scratch : state.historyScratch,
      };

    case 'ADD_PASTE_BLOCK': {
      const lineCount = action.text.split(/\r?\n|\r/).length;
      let pasteId = 1;
      while (state.pasteBlocks[pasteId] !== undefined) pasteId++;
      const marker = `[Pasted text #${pasteId} +${lineCount - 1} lines]`;
      const pos = Math.max(0, Math.min(state.cursorPosition, state.inputText.length));
      const newText =
        state.inputText.slice(0, pos) + marker + state.inputText.slice(pos);
      return {
        ...state,
        inputText: newText,
        cursorPosition: pos + marker.length,
        pasteBlocks: { ...state.pasteBlocks, [pasteId]: action.text },
      };
    }

    default:
      return state;
  }
}

export function createInitialState(model: string): ChatState {
  return {
    messages: [],
    isStreaming: false,
    model,
    error: null,
    inputText: '',
    cursorPosition: 0,
    mode: 'auto',
    turns: [],
    currentTurnId: 0,
    approvalReq: null,
    history: [],
    historyIndex: -1,
    historyScratch: '',
    pasteBlocks: {},
  };
}

/** Replace paste markers with actual content. */
export function expandPasteMarkers(text: string, blocks: Record<number, string>): string {
  return text.replace(/\[Pasted text #(\d+) \+\d+ lines\]/g, (_m, id) => {
    return blocks[Number(id)] ?? _m;
  });
}

export function useChatReducer(model: string) {
  return useReducer(chatReducer, model, createInitialState);
}
