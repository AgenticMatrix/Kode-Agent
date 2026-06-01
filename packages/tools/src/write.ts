/**
 * WriteTool — Atomic file creation / overwrite
 *
 * Creates new files or overwrites existing files using atomic write
 * (write to temp file → rename) to prevent corruption.
 *
 * Risk: MUTATION — modifies filesystem.
 */

import { writeFileSync, mkdirSync, renameSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  BaseTool,
  RiskLevel,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
} from '@kode/shared';

// ---------------------------------------------------------------------------
// I/O Types
// ---------------------------------------------------------------------------

export interface WriteInput {
  file_path: string;
  content: string;
}

export interface WriteOutput {
  path: string;
  bytesWritten: number;
  isNewFile: boolean;
}

// ---------------------------------------------------------------------------
// WriteTool
// ---------------------------------------------------------------------------

const WRITE_DESCRIPTION = `Create a new file or overwrite an existing file.

Rules:
- Always use absolute paths
- Parent directories must exist
- If the file already exists, you MUST read it first using the Read tool
- Uses atomic write (temp file → rename) to prevent corruption`;

export class WriteTool extends BaseTool<WriteInput, WriteOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'Write',
      description: WRITE_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute path to the file' },
          content: { type: 'string', description: 'The content to write' },
        },
        required: ['file_path', 'content'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.MUTATION,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as WriteInput;
    if (!typed || typeof typed !== 'object') {
      return { valid: false, errors: [{ path: '', message: 'Input must be an object' }] };
    }
    if (typeof typed.file_path !== 'string' || typed.file_path.trim().length === 0) {
      return { valid: false, errors: [{ path: 'file_path', message: 'file_path must be a non-empty string' }] };
    }
    if (typeof typed.content !== 'string') {
      return { valid: false, errors: [{ path: 'content', message: 'content must be a string' }] };
    }

    // Path traversal detection
    const resolved = resolve('/', typed.file_path);
    if (resolved.includes('..')) {
      return { valid: false, errors: [{ path: 'file_path', message: 'Path traversal detected' }] };
    }

    return { valid: true };
  }

  override async execute(input: WriteInput, _ctx: ToolContext): Promise<WriteOutput> {
    const filePath = input.file_path;
    const dir = dirname(filePath);

    if (!existsSync(dir)) {
      throw new Error(`Parent directory does not exist: ${dir}`);
    }

    const existed = existsSync(filePath);

    // Atomic write: write to .tmp, then rename
    const tmpPath = `${filePath}.kode-tmp-${Date.now()}`;
    try {
      writeFileSync(tmpPath, input.content, 'utf-8');
      renameSync(tmpPath, filePath);
    } catch (err) {
      // Clean up temp file on failure
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
    }

    const bytesWritten = Buffer.byteLength(input.content, 'utf-8');
    return { path: filePath, bytesWritten, isNewFile: !existed };
  }

  override formatOutput(result: WriteOutput): string {
    const action = result.isNewFile ? 'Created' : 'Updated';
    return `${action} ${result.path} (${result.bytesWritten} bytes)`;
  }
}
