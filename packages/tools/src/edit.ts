/**
 * EditTool — Precise search-and-replace editing
 *
 * Performs exact string replacement in files.
 * Uses the shared `applySearchReplace` utility from @coder/shared.
 *
 * Risk: MUTATION — modifies filesystem.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BaseTool,
  RiskLevel,
  applySearchReplace,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
} from '@coder/shared';

// ---------------------------------------------------------------------------
// I/O Types
// ---------------------------------------------------------------------------

export interface EditInput {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export interface EditOutput {
  path: string;
  matchesFound: number;
  replacementsMade: number;
  newContent: string;
}

// ---------------------------------------------------------------------------
// EditTool
// ---------------------------------------------------------------------------

const EDIT_DESCRIPTION = `Perform exact string replacements in an existing file.

Rules:
- The 'old_string' must match EXACTLY in the file (including whitespace/indentation)
- If 'old_string' is not unique in the file, the edit will FAIL
- Use 'replace_all: true' to replace ALL occurrences
- Always prefer editing existing files in the codebase
- Do NOT create new files with Edit — use Write instead`;

export class EditTool extends BaseTool<EditInput, EditOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'Edit',
      description: EDIT_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute path of the file to edit' },
          old_string: { type: 'string', description: 'The exact text to replace' },
          new_string: { type: 'string', description: 'The replacement text (must be different from old_string)' },
          replace_all: { type: 'boolean', description: 'Replace ALL occurrences (default: false)' },
        },
        required: ['file_path', 'old_string', 'new_string'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.MUTATION,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as EditInput;
    if (!typed || typeof typed !== 'object') {
      return { valid: false, errors: [{ path: '', message: 'Input must be an object' }] };
    }
    if (typeof typed.file_path !== 'string' || typed.file_path.trim().length === 0) {
      return { valid: false, errors: [{ path: 'file_path', message: 'file_path must be a non-empty string' }] };
    }
    if (typeof typed.old_string !== 'string' || typed.old_string.length === 0) {
      return { valid: false, errors: [{ path: 'old_string', message: 'old_string must be a non-empty string' }] };
    }
    if (typeof typed.new_string === 'string' && typed.new_string === typed.old_string) {
      return { valid: false, errors: [{ path: 'new_string', message: 'new_string must differ from old_string' }] };
    }

    // Path traversal detection
    const resolved = resolve('/', typed.file_path);
    if (resolved.includes('..')) {
      return { valid: false, errors: [{ path: 'file_path', message: 'Path traversal detected' }] };
    }

    return { valid: true };
  }

  override async execute(input: EditInput, _ctx: ToolContext): Promise<EditOutput> {
    if (!existsSync(input.file_path)) {
      throw new Error(`File not found: ${input.file_path}. Use Read to verify the path.`);
    }

    const originalContent = readFileSync(input.file_path, 'utf-8');
    const totalMatches = countOccurrences(originalContent, input.old_string);

    if (totalMatches === 0) {
      throw new Error(
        `Match not found: 'old_string' does not appear in the file.\n` +
        `Tip: Use Read to verify the exact content, including whitespace.`,
      );
    }

    if (totalMatches > 1 && !input.replace_all) {
      throw new Error(
        `Multiple matches (${totalMatches}) found and replace_all is not set.\n` +
        `Tip: Use replace_all: true to replace all, or provide a larger string with more context.`,
      );
    }

    // applySearchReplace does single replacement; loop for replace_all
    let newContent = originalContent;
    const maxReplacements = input.replace_all ? totalMatches : 1;
    for (let i = 0; i < maxReplacements; i++) {
      const replaced = applySearchReplace(newContent, input.old_string, input.new_string);
      if (replaced === null) break;
      newContent = replaced;
    }

    // Write the result
    writeFileSync(input.file_path, newContent, 'utf-8');

    return {
      path: input.file_path,
      matchesFound: totalMatches,
      replacementsMade: maxReplacements,
      newContent,
    };
  }

  override formatOutput(result: EditOutput): string {
    return `Edited ${result.path}: ${result.replacementsMade} replacement(s) made`;
  }

  override formatForModel(result: EditOutput): string {
    return `File: ${result.path}\nReplacements: ${result.replacementsMade}\n\n${result.newContent}`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countOccurrences(text: string, search: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}
