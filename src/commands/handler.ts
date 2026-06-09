/**
 * Slash command handler — parses /command input and dispatches to the registry.
 */

import type { ChatAction } from '../types.js';
import { findSlashCommand } from './registry.js';
import type { SlashRunContext } from './types.js';

export interface ParsedSlashCommand {
  /** The command name (without leading /) */
  name: string;
  /** The argument text after the command name */
  arg: string;
}

/** Parse a slash command string into name + arg. */
export function parseSlashCommand(input: string): ParsedSlashCommand {
  const trimmed = input.startsWith('/') ? input.slice(1) : input;
  const spaceIdx = trimmed.indexOf(' ');

  if (spaceIdx === -1) {
    return { name: trimmed, arg: '' };
  }

  return {
    name: trimmed.slice(0, spaceIdx),
    arg: trimmed.slice(spaceIdx + 1).trim(),
  };
}

/** Check if a string is a slash command (starts with /). */
export function isSlashCommand(input: string): boolean {
  return input.startsWith('/') && input.length > 1 && !input.startsWith('//');
}

export interface SlashHandlerDeps {
  dispatch: (action: ChatAction) => void;
  send: (text: string) => void;
  model: string;
  isStreaming: boolean;
  inputText: string;
  onExit: () => void;
}

/**
 * Create a slash command handler.
 * Returns a function that handles a slash command string.
 * Returns true if the input was handled as a slash command, false otherwise.
 */
export function createSlashHandler(deps: SlashHandlerDeps): (input: string) => boolean {
  const { dispatch, send, model, isStreaming, inputText, onExit } = deps;

  return (input: string): boolean => {
    const parsed = parseSlashCommand(input);
    const cmd = findSlashCommand(parsed.name);

    if (!cmd) {
      // Unknown command — could be handled by the agent as a skill/tool later
      return false;
    }

    const ctx: SlashRunContext = {
      rawCommand: input,
      arg: parsed.arg,
      dispatch,
      send,
      sys: (message: string) => {
        dispatch({
          type: 'ADD_USER_MESSAGE',
          message: {
            id: Date.now(),
            role: 'system',
            content: message,
            blocks: [{ type: 'text', content: message }],
            timestamp: Date.now(),
          },
        });
      },
      exit: onExit,
      model,
      isStreaming,
      inputText,
    };

    cmd.run(parsed.arg, ctx);
    return true;
  };
}
