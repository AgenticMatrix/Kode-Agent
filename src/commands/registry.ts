import type { SlashCommand } from './types.js';
import { coreCommands } from './commands/core.js';

export const SLASH_COMMANDS: SlashCommand[] = [
  ...coreCommands,
];

const byName = new Map<string, SlashCommand>(
  SLASH_COMMANDS.flatMap(
    (cmd) => [cmd.name, ...(cmd.aliases ?? [])].map((name) => [name.toLowerCase(), cmd] as const),
  ),
);

/** Look up a slash command by name. Returns undefined if not found. */
export function findSlashCommand(name: string): SlashCommand | undefined {
  return byName.get(name.toLowerCase());
}

/** All registered command names (for help display). */
export function listCommandNames(): string[] {
  return [...new Set(SLASH_COMMANDS.map((c) => c.name))].sort();
}
