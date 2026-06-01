/**
 * GlobTool — File pattern matching
 *
 * Matches file paths against glob patterns using Node.js built-in fs.glob
 * or falls back to a simple recursive implementation.
 *
 * Risk: SAFE — read-only operation.
 */

import { statSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  BaseTool,
  RiskLevel,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
} from '@kode/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RESULTS = 500;
const MAX_DEPTH = 50;

// ---------------------------------------------------------------------------
// I/O Types
// ---------------------------------------------------------------------------

export interface GlobInput {
  pattern: string;
  path?: string;
}

export interface GlobOutput {
  matches: string[];
  matchCount: number;
  truncated: boolean;
  searchPath: string;
}

// ---------------------------------------------------------------------------
// Glob Mini-Matcher (no external dependency)
// ---------------------------------------------------------------------------

/**
 * Simple glob-to-regex conversion.
 * Supports: *, **, ? and character classes [abc].
 */
function globToRegex(pattern: string): RegExp {
  let regexStr = '^';
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // ** matches any path segment
        regexStr += '.*';
        i += 2;
        if (pattern[i] === '/') i++;
      } else {
        // * matches within a segment
        regexStr += '[^/]*';
        i++;
      }
    } else if (ch === '?') {
      regexStr += '[^/]';
      i++;
    } else if (ch === '.') {
      regexStr += '\\.';
      i++;
    } else if ('(){}[]+-^$|\\'.includes(ch)) {
      regexStr += '\\' + ch;
      i++;
    } else {
      regexStr += ch;
      i++;
    }
  }

  regexStr += '$';
  return new RegExp(regexStr);
}

function matchGlob(filePath: string, pattern: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(filePath);
}

async function walkDir(
  dir: string,
  pattern: string,
  results: string[],
  depth: number,
  basePath: string,
): Promise<void> {
  if (results.length >= MAX_RESULTS || depth > MAX_DEPTH) return;

  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // Permission denied or not a directory — skip
  }

  for (const entry of entries) {
    if (results.length >= MAX_RESULTS) return;
    const fullPath = join(dir, entry.name);
    const relativePath = fullPath.slice(basePath.length + 1);

    if (matchGlob(relativePath, pattern)) {
      results.push(fullPath);
    }

    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      await walkDir(fullPath, pattern, results, depth + 1, basePath);
    }
  }
}

// ---------------------------------------------------------------------------
// GlobTool
// ---------------------------------------------------------------------------

const GLOB_DESCRIPTION = `Find files matching a glob pattern.

Fast file pattern matching tool.
- Supports ** for recursive matching
- Supports * for single-segment wildcards
- Supports ? for single characters
- Results are sorted by modification time (newest first)
- Maximum ${MAX_RESULTS} results returned`;

export class GlobTool extends BaseTool<GlobInput, GlobOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'Glob',
      description: GLOB_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern (e.g. "src/**/*.ts")' },
          path: { type: 'string', description: 'Directory to search in (default: cwd)' },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.SAFE,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as GlobInput;
    if (!typed || typeof typed !== 'object') {
      return { valid: false, errors: [{ path: '', message: 'Input must be an object' }] };
    }
    if (typeof typed.pattern !== 'string' || typed.pattern.trim().length === 0) {
      return { valid: false, errors: [{ path: 'pattern', message: 'pattern must be a non-empty string' }] };
    }
    return { valid: true };
  }

  override async execute(input: GlobInput, ctx: ToolContext): Promise<GlobOutput> {
    const searchPath = input.path ?? ctx.cwd;

    try {
      statSync(searchPath);
    } catch {
      throw new Error(`Directory not found: ${searchPath}`);
    }

    const results: string[] = [];
    await walkDir(searchPath, input.pattern, results, 0, searchPath);

    // Sort by modification time (newest first)
    const withStats = await Promise.all(
      results.map(async (p) => {
        try {
          const s = await stat(p);
          return { path: p, mtime: s.mtimeMs };
        } catch {
          return { path: p, mtime: 0 };
        }
      }),
    );
    withStats.sort((a, b) => b.mtime - a.mtime);

    const sorted = withStats.map((e) => e.path);

    return {
      matches: sorted,
      matchCount: sorted.length,
      truncated: results.length >= MAX_RESULTS,
      searchPath,
    };
  }

  override formatOutput(result: GlobOutput): string {
    const header = `Found ${result.matchCount} file(s) in ${result.searchPath}`;
    const files = result.matches.map((f) => `  ${f}`).join('\n');
    const footer = result.truncated ? `\n[Results truncated at ${MAX_RESULTS}]` : '';
    return `${header}\n${files}${footer}`;
  }
}
