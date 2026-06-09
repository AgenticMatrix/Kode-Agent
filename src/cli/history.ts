/**
 * Input history — persisted to ~/.coder/history.json.
 *
 * Deduplicates consecutive identical entries and caps at 1000 lines.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HISTORY_PATH = join(homedir(), '.coder', 'history.json');
const MAX_ENTRIES = 1000;

function ensureDir(): void {
  const dir = join(homedir(), '.coder');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function loadHistory(): string[] {
  try {
    ensureDir();
    const raw = readFileSync(HISTORY_PATH, 'utf-8');
    const data = JSON.parse(raw) as unknown;
    if (Array.isArray(data)) return data.filter((v): v is string => typeof v === 'string');
    return [];
  } catch {
    return [];
  }
}

export function saveHistory(history: string[]): void {
  ensureDir();
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
}

/**
 * Append a line to history. Skips duplicates of the most recent entry.
 */
export function addToHistory(line: string, existing?: string[]): string[] {
  const history = existing ?? loadHistory();
  const trimmed = line.trim();
  if (trimmed.length === 0) return history;
  if (history.length > 0 && history[history.length - 1] === trimmed) return history;
  history.push(trimmed);
  if (history.length > MAX_ENTRIES) history.splice(0, history.length - MAX_ENTRIES);
  saveHistory(history);
  return history;
}
