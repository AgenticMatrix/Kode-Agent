/**
 * Context loader — gathers environment info and project/user configuration
 * for injection into the system prompt.
 *
 * Two concerns:
 *   1. EnvInfo        — OS, shell, git, date, model
 *   2. CodeAgentContext — CODERAGENT.md from project (~/.coder/) directories
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir, type, release } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnvInfo {
  cwd: string;
  platform: string;
  osVersion: string;
  shell: string;
  currentDate: string;
  isGitRepo: boolean;
  gitBranch?: string;
  gitStatusSummary?: string;
}

export interface CodeAgentContext {
  projectContext?: string;
  userContext?: string;
  projectPath?: string;
  userPath?: string;
}

export interface SystemContext {
  envInfo: EnvInfo;
  codeAgentContext: CodeAgentContext;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a git command, return stdout.trim() or empty string on failure.
 */
function git(args: string[], cwd: string): string {
  try {
    return execSync(`git ${args.join(' ')}`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 3000,
    }).trim();
  } catch {
    return '';
  }
}

function parseGitStatusSummary(raw: string): string {
  const lines = raw.split('\n').filter(Boolean);
  let modified = 0;
  let added = 0;
  let deleted = 0;
  let untracked = 0;

  for (const line of lines) {
    // git status --porcelain format: XY filename
    // X = index status, Y = working tree status
    const x = line[0] ?? ' ';
    const y = line[1] ?? ' ';

    if (x === '?' && y === '?') {
      untracked++;
      continue;
    }
    if (x === 'A' || y === 'A') added++;
    if (x === 'D' || y === 'D') deleted++;
    if (
      (x !== ' ' && x !== '!' && x !== '?') ||
      (y !== ' ' && y !== '!' && y !== '?')
    ) {
      modified++;
    }
  }

  const parts: string[] = [];
  if (modified > 0) parts.push(`${modified} modified`);
  if (added > 0) parts.push(`${added} added`);
  if (deleted > 0) parts.push(`${deleted} deleted`);
  if (untracked > 0) parts.push(`${untracked} untracked`);
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// computeEnvInfo
// ---------------------------------------------------------------------------

export function computeEnvInfo(cwd: string, _model?: string): EnvInfo {
  const info: EnvInfo = {
    cwd,
    platform: process.platform,
    osVersion: `${type()} ${release()}`,
    shell: process.env.SHELL ?? (process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'),
    currentDate: new Date().toDateString(),
    isGitRepo: false,
  };

  // Git detection
  const insideWorkTree = git(['rev-parse', '--is-inside-work-tree'], cwd);
  if (insideWorkTree === 'true') {
    info.isGitRepo = true;
    info.gitBranch = git(['branch', '--show-current'], cwd) || undefined;

    const statusRaw = git(['status', '--porcelain'], cwd);
    if (statusRaw) {
      info.gitStatusSummary = parseGitStatusSummary(statusRaw);
    }
  }

  return info;
}

// ---------------------------------------------------------------------------
// loadCodeAgentContext — CODERAGENT.md discovery
// ---------------------------------------------------------------------------

const CODERAGENT_FILENAME = 'CODERAGENT.md';

function tryReadFile(...segments: string[]): { content: string; path: string } | null {
  const filePath = join(...segments);
  try {
    const content = readFileSync(filePath, 'utf-8').trim();
    if (content.length === 0) return null;
    return { content, path: filePath };
  } catch {
    return null;
  }
}

export function loadCodeAgentContext(cwd: string): CodeAgentContext {
  const result: CodeAgentContext = {};

  // Project-level: <cwd>/CODERAGENT.md
  const project = tryReadFile(cwd, CODERAGENT_FILENAME);
  if (project) {
    result.projectContext = project.content;
    result.projectPath = project.path;
  }

  // User-level: ~/.coder/CODERAGENT.md
  const user = tryReadFile(homedir(), '.coder', CODERAGENT_FILENAME);
  if (user) {
    result.userContext = user.content;
    result.userPath = user.path;
  }

  return result;
}

// ---------------------------------------------------------------------------
// loadSystemContext — convenience combiner
// ---------------------------------------------------------------------------

export function loadSystemContext(cwd: string, model?: string): SystemContext {
  return {
    envInfo: computeEnvInfo(cwd, model),
    codeAgentContext: loadCodeAgentContext(cwd),
  };
}
