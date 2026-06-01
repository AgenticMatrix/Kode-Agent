/**
 * GrepTool — Content regex search (ripgrep / Node fallback)
 *
 * Searches file contents using regular expressions.
 * Tries to use ripgrep (rg) via child_process first, falls back to Node.js
 * line-by-line scanning.
 *
 * Risk: SAFE — read-only operation.
 */

import { exec } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';
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

const MAX_RESULTS = 250;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per file
const RG_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// I/O Types
// ---------------------------------------------------------------------------

export interface GrepInput {
  pattern: string;
  path?: string;
  glob?: string;
  output_mode?: 'content' | 'files_with_matches' | 'count';
  ['-i']?: boolean;
  ['-A']?: number;
  ['-B']?: number;
  ['-C']?: number;
  multiline?: boolean;
}

export interface GrepMatch {
  file: string;
  line: number;
  column: number;
  content: string;
  context?: string;
}

export interface GrepOutput {
  matches: GrepMatch[];
  matchCount: number;
  filesSearched: number;
  truncated: boolean;
  searchPath: string;
}

// ---------------------------------------------------------------------------
// GrepTool
// ---------------------------------------------------------------------------

const GREP_DESCRIPTION = `Search file contents using regular expressions.

Powerful regex-based search using ripgrep (or Node.js fallback).
- Supports full regex syntax
- Supports context lines (-A, -B, -C) when output_mode is 'content'
- Supports case-insensitive search (-i)
- Supports multiline matching (multiline: true)
- Use 'glob' to filter by file pattern (e.g. "*.ts")
- output_mode: 'content' shows matching lines, 'files_with_matches' shows file paths, 'count' shows match counts`;

export class GrepTool extends BaseTool<GrepInput, GrepOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'Grep',
      description: GREP_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regular expression pattern to search for' },
          path: { type: 'string', description: 'File or directory to search in (default: cwd)' },
          glob: { type: 'string', description: 'Glob pattern to filter files (e.g. "*.ts")' },
          output_mode: {
            type: 'string',
            enum: ['content', 'files_with_matches', 'count'],
            description: 'Output mode (default: files_with_matches)',
          },
          '-i': { type: 'boolean', description: 'Case insensitive search' },
          '-A': { type: 'number', description: 'Lines to show after each match' },
          '-B': { type: 'number', description: 'Lines to show before each match' },
          '-C': { type: 'number', description: 'Lines to show before and after each match' },
          multiline: { type: 'boolean', description: 'Enable multiline mode' },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.SAFE,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as GrepInput;
    if (!typed || typeof typed !== 'object') {
      return { valid: false, errors: [{ path: '', message: 'Input must be an object' }] };
    }
    if (typeof typed.pattern !== 'string' || typed.pattern.trim().length === 0) {
      return { valid: false, errors: [{ path: 'pattern', message: 'pattern must be a non-empty string' }] };
    }
    return { valid: true };
  }

  override async execute(input: GrepInput, ctx: ToolContext): Promise<GrepOutput> {
    const searchPath = input.path ?? ctx.cwd;

    if (!existsSync(searchPath)) {
      throw new Error(`Path not found: ${searchPath}`);
    }

    // Try ripgrep first for performance
    try {
      return await this.rgSearch(input, searchPath);
    } catch {
      // Fallback to Node.js search
      return await this.nodeSearch(input, searchPath);
    }
  }

  private rgSearch(input: GrepInput, searchPath: string): Promise<GrepOutput> {
    return new Promise((resolve, reject) => {
      const args: string[] = ['--no-heading', '--with-filename', '--line-number', '--color', 'never'];

      if (input['-i']) args.push('-i');
      if (input.multiline) { args.push('--multiline'); args.push('--multiline-dotall'); }
      if (input.glob) args.push('--glob', input.glob);

      const context = input['-C'] ?? input['-A'] ?? input['-B'] ?? undefined;
      if (context && input.output_mode !== 'files_with_matches') {
        args.push('-C', String(context));
      }

      switch (input.output_mode) {
        case 'files_with_matches':
          args.push('-l');
          break;
        case 'count':
          args.push('-c');
          break;
      }

      args.push('--', input.pattern, searchPath);

      exec(`rg ${args.join(' ')}`, {
        timeout: RG_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error && !stdout) {
          // rg not found or error — fallback
          reject(error);
          return;
        }

        const lines = stdout.trim().split('\n').filter(Boolean);
        const matches: GrepMatch[] = [];

        if (input.output_mode === 'files_with_matches') {
          for (const line of lines) {
            matches.push({ file: line, line: 0, column: 0, content: '' });
          }
        } else if (input.output_mode === 'count') {
          for (const line of lines) {
            const [file, count] = line.split(':') as [string, string];
            matches.push({ file, line: 0, column: 0, content: `Matches: ${count}` });
          }
        } else {
          for (const line of lines.slice(0, MAX_RESULTS)) {
            // Format: file:line:content  or  file:line:col:content
            const idx1 = line.indexOf(':');
            const idx2 = line.indexOf(':', idx1 + 1);
            if (idx1 === -1 || idx2 === -1) continue;

            const file = line.slice(0, idx1);
            const lineNum = parseInt(line.slice(idx1 + 1, idx2), 10);
            const content = line.slice(idx2 + 1);

            matches.push({ file, line: lineNum, column: 0, content });
          }
        }

        resolve({
          matches: matches.slice(0, MAX_RESULTS),
          matchCount: matches.length,
          filesSearched: new Set(matches.map((m) => m.file)).size,
          truncated: matches.length >= MAX_RESULTS,
          searchPath,
        });
      });
    });
  }

  private async nodeSearch(input: GrepInput, searchPath: string): Promise<GrepOutput> {
    const matches: GrepMatch[] = [];
    const flags = input.multiline ? 'gs' : 'g';
    const caseFlag = input['-i'] ? 'i' : '';
    const regex = new RegExp(input.pattern, `${flags}${caseFlag}`);

    await this.searchDir(searchPath, input.glob, regex, input.output_mode ?? 'files_with_matches', matches);
    return {
      matches: matches.slice(0, MAX_RESULTS),
      matchCount: matches.length,
      filesSearched: new Set(matches.map((m) => m.file)).size,
      truncated: matches.length >= MAX_RESULTS,
      searchPath,
    };
  }

  private async searchDir(
    dir: string,
    glob: string | undefined,
    regex: RegExp,
    outputMode: string,
    results: GrepMatch[],
  ): Promise<void> {
    if (results.length >= MAX_RESULTS) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= MAX_RESULTS) return;
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        await this.searchDir(fullPath, glob, regex, outputMode, results);
      } else if (entry.isFile()) {
        if (glob && !matchSimpleGlob(entry.name, glob)) continue;
        await this.searchFile(fullPath, regex, outputMode, results);
      }
    }
  }

  private async searchFile(
    filePath: string,
    regex: RegExp,
    outputMode: string,
    results: GrepMatch[],
  ): Promise<void> {
    if (results.length >= MAX_RESULTS) return;

    try {
      const st = await stat(filePath);
      if (st.size > MAX_FILE_SIZE) return;
    } catch {
      return;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      let match;
      let count = 0;

      while ((match = regex.exec(content)) !== null) {
        count++;
        if (outputMode === 'content' && results.length < MAX_RESULTS) {
          const before = content.slice(0, match.index);
          const line = before.split('\n').length;
          results.push({
            file: filePath,
            line,
            column: match.index - before.lastIndexOf('\n'),
            content: match[0],
          });
        }
        if (!regex.global) break;
      }

      if (outputMode === 'count' && count > 0) {
        results.push({
          file: filePath,
          line: 0,
          column: 0,
          content: `Matches: ${count}`,
        });
      } else if (outputMode === 'files_with_matches' && count > 0) {
        results.push({ file: filePath, line: 0, column: 0, content: '' });
      }
    } catch {
      // Binary file or permission error — skip
    }
  }

  override formatOutput(result: GrepOutput): string {
    if (result.matches.length === 0) return 'No matches found.';
    const lines = result.matches.map((m) =>
      m.line > 0
        ? `${m.file}:${m.line}: ${m.content}`
        : `${m.file}: ${m.content}`,
    );
    const footer = result.truncated ? `\n[Results truncated at ${MAX_RESULTS}]` : '';
    return `Found ${result.matchCount} match(es) in ${result.filesSearched} file(s)\n${lines.join('\n')}${footer}`;
  }
}

function matchSimpleGlob(filename: string, pattern: string): boolean {
  return new RegExp(
    '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
    'i',
  ).test(filename);
}
