/**
 * Slash command types — minimal, self-contained command interface.
 */

import type { ChatAction } from '../types.js';

export interface SlashRunContext {
  /** The raw slash command string (including leading /) */
  rawCommand: string;
  /** The argument text after the command name */
  arg: string;
  /** Dispatch a ChatAction to the reducer */
  dispatch: (action: ChatAction) => void;
  /** Send a user message (text) directly to the agent */
  send: (text: string) => void;
  /** Post a system message to the transcript */
  sys: (message: string) => void;
  /** Exit the process immediately */
  exit: () => void;
  /** Current model name */
  model: string;
  /** Whether the agent is currently streaming */
  isStreaming: boolean;
  /** Current input text */
  inputText: string;
}

export interface SlashCommand {
  /** Primary command name (without leading /) */
  name: string;
  /** Alternative names */
  aliases?: string[];
  /** Short description shown in /help */
  help: string;
  /** Optional usage string (e.g. "/model <name>") */
  usage?: string;
  /** Execute the command */
  run: (arg: string, ctx: SlashRunContext) => void;
}
