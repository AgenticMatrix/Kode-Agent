/**
 * @codingagent/commands — Slash command system.
 *
 * Provides a minimal, self-contained slash command framework:
 *   - Command interface (SlashCommand, SlashRunContext)
 *   - Registry with name/alias lookup
 *   - Handler that parses /command input and dispatches to the registry
 *
 * Usage:
 *   import { createSlashHandler } from './commands/index.js';
 *   const handler = createSlashHandler({ dispatch, send, model, ... });
 *   handler('/help'); // → true (handled)
 *   handler('hello'); // → false (not a slash command)
 */

export type { SlashCommand, SlashRunContext } from './types.js';
export { SLASH_COMMANDS, findSlashCommand, listCommandNames } from './registry.js';
export {
  createSlashHandler,
  parseSlashCommand,
  isSlashCommand,
} from './handler.js';
export type { ParsedSlashCommand, SlashHandlerDeps } from './handler.js';
