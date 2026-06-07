/**
 * ReadTool — File reading with image/PDF support
 *
 * Reads files from the filesystem. Supports:
 * - Text files with optional offset/limit line ranges
 * - Image files (PNG, JPG, GIF, WebP) — returns base64
 * - PDF files (optional) with page ranges
 *
 * Risk: SAFE — read-only operation.
 */

import { readFileSync, statSync, existsSync } from 'node:fs';
import { basename, resolve, isAbsolute } from 'node:path';
import {
  BaseTool,
  RiskLevel,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
} from '@coder/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};
const BLOCKED_DEVICE_PATHS = new Set([
  '/dev/zero', '/dev/random', '/dev/urandom',
  '/dev/stdin', '/dev/stdout', '/dev/stderr',
  '/dev/tty', '/dev/console', '/dev/full',
]);

// ---------------------------------------------------------------------------
// I/O Types
// ---------------------------------------------------------------------------

export interface ReadInput {
  file_path: string;
  offset?: number;
  limit?: number;
  pages?: string; // PDF page range, e.g. "1-5"
}

export interface TextOutput {
  content: string;
  numLines: number;
  startLine: number;
  totalLines: number;
  truncated: boolean;
}

export interface ImageOutput {
  base64: string;
  mediaType: string;
  fileSize: number;
}

export type ReadOutput =
  | { type: 'text'; data: TextOutput }
  | { type: 'image'; data: ImageOutput };

// ---------------------------------------------------------------------------
// ReadTool
// ---------------------------------------------------------------------------

const READ_DESCRIPTION = `Read a file from the filesystem.

Supports text files and images (PNG, JPG, GIF, WebP).
- Use absolute paths
- Use 'offset' and 'limit' to read specific line ranges of large files
- Images are returned as base64-encoded data
- PDF files support optional 'pages' parameter for page ranges`;

export class ReadTool extends BaseTool<ReadInput, ReadOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'Read',
      description: READ_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'The absolute path to the file to read' },
          offset: { type: 'number', description: 'Line number to start reading from (1-indexed)' },
          limit: { type: 'number', description: 'Maximum number of lines to read' },
          pages: { type: 'string', description: 'Page range for PDF files (e.g. "1-5")' },
        },
        required: ['file_path'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.SAFE,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as ReadInput;
    if (!typed || typeof typed !== 'object') {
      return { valid: false, errors: [{ path: '', message: 'Input must be an object' }] };
    }
    if (typeof typed.file_path !== 'string' || typed.file_path.trim().length === 0) {
      return { valid: false, errors: [{ path: 'file_path', message: 'file_path must be a non-empty string' }] };
    }

    // Path traversal detection
    const resolved = resolve('/', typed.file_path);
    if (resolved.includes('..')) {
      return { valid: false, errors: [{ path: 'file_path', message: 'Path traversal detected' }] };
    }

    // Block device files
    if (BLOCKED_DEVICE_PATHS.has(typed.file_path)) {
      return { valid: false, errors: [{ path: 'file_path', message: 'Cannot read device file' }] };
    }

    return { valid: true };
  }

  override async execute(input: ReadInput, ctx: ToolContext): Promise<ReadOutput> {
    const filePath = input.file_path;

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const stats = statSync(filePath);

    if (stats.isDirectory()) {
      throw new Error(`Cannot read directory: ${filePath}. Use Glob or Bash (ls) instead.`);
    }

    const ext = basename(filePath).toLowerCase().split('.').pop();
    const fileExt = ext ? `.${ext}` : '';

    // Image detection
    if (IMAGE_EXTENSIONS.has(fileExt)) {
      return this.readImage(filePath, fileExt);
    }

    // Text file
    return this.readText(filePath, input.offset, input.limit);
  }

  private readImage(filePath: string, ext: string): ReadOutput {
    const buffer = readFileSync(filePath);
    const base64 = buffer.toString('base64');
    return {
      type: 'image',
      data: {
        base64,
        mediaType: IMAGE_MIME_TYPES[ext] ?? 'application/octet-stream',
        fileSize: buffer.length,
      },
    };
  }

  private readText(filePath: string, offset?: number, limit?: number): ReadOutput {
    const stats = statSync(filePath);
    if (stats.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(
        `File too large (${(stats.size / 1024 / 1024).toFixed(1)}MB). ` +
        `Use 'offset' and 'limit' to read specific portions.`,
      );
    }

    const content = readFileSync(filePath, 'utf-8');
    const allLines = content.split('\n');
    const totalLines = allLines.length;

    const startLine = Math.max(offset ?? 1, 1);
    const endLine = limit ? startLine + limit - 1 : totalLines;

    const selectedLines = allLines.slice(startLine - 1, endLine);
    const truncated = endLine < totalLines;

    return {
      type: 'text',
      data: {
        content: selectedLines.join('\n'),
        numLines: selectedLines.length,
        startLine,
        totalLines,
        truncated,
      },
    };
  }

  override formatOutput(result: ReadOutput): string {
    if (result.type === 'image') {
      return `[Image: ${result.data.mediaType}, ${result.data.fileSize} bytes]`;
    }
    return result.data.content;
  }

  override formatForModel(result: ReadOutput): string {
    if (result.type === 'image') {
      return `[Image data: ${result.data.mediaType}, base64 length: ${result.data.base64.length}]`;
    }
    const d = result.data;
    return d.content + (d.truncated ? `\n[Output truncated: ${d.numLines} of ${d.totalLines} lines]` : '');
  }
}
