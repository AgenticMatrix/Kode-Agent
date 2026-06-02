/**
 * notebook-edit.ts — NotebookEdit tool: modify Jupyter notebook cells
 *
 * Reads .ipynb (JSON), locates a cell by ID or index, and performs
 * replace/insert/delete operations. Supports code and markdown cells.
 *
 * Risk: MUTATION — modifies notebook files on disk.
 * Architecture reference: ARCHITECTURE.md §4.6 (Tool System)
 */

import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  BaseTool,
  RiskLevel,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
} from '@coder/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CellType = 'code' | 'markdown';
export type EditMode = 'replace' | 'insert' | 'delete';

export interface NotebookEditInput {
  /** Absolute path to the .ipynb file */
  notebook_path: string;
  /** ID of the cell to target (for replace/delete modes and insert-after) */
  cell_id?: string;
  /** New source content for the cell */
  new_source: string;
  /** Cell type (default: retains existing type, or 'code' for insert) */
  cell_type?: CellType;
  /** Edit operation mode (default: replace) */
  edit_mode?: EditMode;
}

export interface NotebookEditOutput {
  notebookPath: string;
  cellIndex: number;
  cellId: string;
  editMode: EditMode;
  cellType: CellType;
  totalCells: number;
  sourcePreview: string;
}

/** Jupyter notebook v4 JSON structure */
interface NotebookCell {
  cell_type: CellType;
  source: string | string[];
  metadata: Record<string, unknown>;
  outputs?: unknown[];
  execution_count?: number | null;
  id?: string;
}

interface NotebookJSON {
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_PREVIEW_MAX = 500;

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

const NOTEBOOK_EDIT_DESCRIPTION = `Edit a Jupyter notebook (.ipynb) cell.

Reads the notebook JSON, locates a cell by ID or index, and performs the
specified edit operation.

Edit modes:
- replace (default): Replace the source content of the target cell
- insert: Insert a new cell AFTER the target cell (or at end if no cell_id)
- delete: Remove the target cell from the notebook

Cell IDs are optional — if not provided for replace/delete, the first cell
is targeted. For insert without cell_id, the new cell is appended at the end.`;

// ---------------------------------------------------------------------------
// NotebookEditTool
// ---------------------------------------------------------------------------

export class NotebookEditTool extends BaseTool<NotebookEditInput, NotebookEditOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'NotebookEdit',
      description: NOTEBOOK_EDIT_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          notebook_path: {
            type: 'string',
            description: 'Absolute path to the .ipynb file to edit',
          },
          cell_id: {
            type: 'string',
            description: 'ID of the cell to target. For insert mode, the new cell is inserted after this cell. If omitted: first cell for replace/delete, end for insert.',
          },
          new_source: {
            type: 'string',
            description: 'New source content for the cell (required for replace and insert modes)',
          },
          cell_type: {
            type: 'string',
            enum: ['code', 'markdown'],
            description: 'Cell type. Defaults to existing cell type for replace, "code" for insert.',
          },
          edit_mode: {
            type: 'string',
            enum: ['replace', 'insert', 'delete'],
            description: 'Edit operation mode. Default: replace.',
          },
        },
        required: ['notebook_path', 'new_source'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.MUTATION,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as NotebookEditInput;
    if (!typed || typeof typed !== 'object') {
      return { valid: false, errors: [{ path: '', message: 'Input must be an object' }] };
    }

    if (typeof typed.notebook_path !== 'string' || !typed.notebook_path.endsWith('.ipynb')) {
      return {
        valid: false,
        errors: [{ path: 'notebook_path', message: 'notebook_path must be a string ending with .ipynb' }],
      };
    }

    if (typeof typed.new_source !== 'string') {
      return {
        valid: false,
        errors: [{ path: 'new_source', message: 'new_source must be a string' }],
      };
    }

    if (typed.cell_type !== undefined &&
        typed.cell_type !== 'code' &&
        typed.cell_type !== 'markdown') {
      return {
        valid: false,
        errors: [{ path: 'cell_type', message: 'cell_type must be "code" or "markdown"' }],
      };
    }

    if (typed.edit_mode !== undefined &&
        typed.edit_mode !== 'replace' &&
        typed.edit_mode !== 'insert' &&
        typed.edit_mode !== 'delete') {
      return {
        valid: false,
        errors: [{ path: 'edit_mode', message: 'edit_mode must be "replace", "insert", or "delete"' }],
      };
    }

    return { valid: true };
  }

  override async execute(
    input: NotebookEditInput,
    ctx: ToolContext,
  ): Promise<NotebookEditOutput> {
    const editMode = input.edit_mode ?? 'replace';
    const notebookPath = this.resolvePath(input.notebook_path, ctx.cwd);

    // Read and parse the notebook
    if (!existsSync(notebookPath)) {
      throw new Error(`Notebook not found: ${notebookPath}`);
    }

    let raw: string;
    try {
      raw = readFileSync(notebookPath, 'utf-8');
    } catch {
      throw new Error(`Failed to read notebook: ${notebookPath}`);
    }

    let notebook: NotebookJSON;
    try {
      notebook = JSON.parse(raw) as NotebookJSON;
    } catch {
      throw new Error(`Failed to parse notebook JSON: ${notebookPath}`);
    }

    if (!Array.isArray(notebook.cells)) {
      throw new Error(`Invalid notebook format: missing cells array`);
    }

    // Find the target cell index
    const cellIndex = this.findCellIndex(notebook, input.cell_id, editMode);

    if (cellIndex === -1 && editMode !== 'insert') {
      throw new Error(
        input.cell_id
          ? `Cell with ID "${input.cell_id}" not found in notebook`
          : `Notebook has no cells to target`,
      );
    }

    let targetCell: NotebookCell | null = null;
    let cellId: string;

    switch (editMode) {
      case 'replace': {
        targetCell = notebook.cells[cellIndex]!;
        const cellType = input.cell_type ?? targetCell.cell_type;
        targetCell.source = this.normalizeSource(input.new_source);
        targetCell.cell_type = cellType;
        cellId = targetCell.id ?? this.ensureCellId(targetCell);
        break;
      }

      case 'insert': {
        const cellType = input.cell_type ?? 'code';
        const newCell: NotebookCell = {
          cell_type: cellType,
          source: this.normalizeSource(input.new_source),
          metadata: {},
          id: randomUUID(),
        };
        if (cellType === 'code') {
          newCell.outputs = [];
          newCell.execution_count = null;
        }

        const insertAt = cellIndex >= 0 ? cellIndex + 1 : notebook.cells.length;
        notebook.cells.splice(insertAt, 0, newCell);
        cellId = newCell.id!;
        targetCell = newCell;
        break;
      }

      case 'delete': {
        targetCell = notebook.cells[cellIndex]!;
        cellId = targetCell.id ?? `index-${cellIndex}`;
        notebook.cells.splice(cellIndex, 1);
        break;
      }

      default:
        throw new Error(`Unknown edit mode: ${editMode}`);
    }

    // Atomic write back
    const tmpPath = notebookPath + '.tmp';
    const bakPath = notebookPath + '.bak';

    writeFileSync(tmpPath, JSON.stringify(notebook, null, 1) + '\n', 'utf-8');

    if (existsSync(notebookPath)) {
      try { renameSync(notebookPath, bakPath); } catch { /* ok */ }
    }

    try {
      renameSync(tmpPath, notebookPath);
    } catch {
      // Restore backup on failure
      if (existsSync(bakPath)) {
        try { renameSync(bakPath, notebookPath); } catch { /* ok */ }
      }
      throw new Error('Failed to write notebook');
    }

    // Clean up
    if (existsSync(bakPath)) {
      try { unlinkSync(bakPath); } catch { /* ok */ }
    }
    if (existsSync(tmpPath)) {
      try { unlinkSync(tmpPath); } catch { /* ok */ }
    }

    return {
      notebookPath,
      cellIndex: editMode === 'insert' && cellIndex >= 0 ? cellIndex + 1 : cellIndex,
      cellId,
      editMode,
      cellType: targetCell?.cell_type ?? (input.cell_type ?? 'code'),
      totalCells: notebook.cells.length,
      sourcePreview: this.getSourcePreview(targetCell),
    };
  }

  override formatOutput(result: NotebookEditOutput): string {
    const lines = [
      `NotebookEdit [${result.editMode}] on ${result.notebookPath}`,
      `Cell index: ${result.cellIndex}, ID: ${result.cellId}, type: ${result.cellType}`,
      `Total cells: ${result.totalCells}`,
    ];

    if (result.editMode !== 'delete') {
      lines.push(`Source preview:\n\`\`\`\n${result.sourcePreview}\n\`\`\``);
    }

    return lines.join('\n');
  }

  // -------------------------------------------------------------------
  // Private: helpers
  // -------------------------------------------------------------------

  /**
   * Resolve a path — if absolute, use as-is; if relative, resolve against cwd.
   */
  private resolvePath(notebookPath: string, cwd: string): string {
    if (isAbsolute(notebookPath)) return notebookPath;
    return resolve(cwd, notebookPath);
  }

  /**
   * Find the index of a target cell in the notebook.
   */
  private findCellIndex(
    notebook: NotebookJSON,
    cellId: string | undefined,
    mode: EditMode,
  ): number {
    if (cellId) {
      return notebook.cells.findIndex((c) => c.id === cellId);
    }

    // No cell_id provided — use defaults
    if (mode === 'insert') {
      return notebook.cells.length - 1; // Insert at end
    }

    // replace/delete without cell_id → target first cell
    return notebook.cells.length > 0 ? 0 : -1;
  }

  /**
   * Normalize source to a string (Jupyter allows string or string[]).
   */
  private normalizeSource(source: string): string {
    return source;
  }

  /**
   * Ensure a cell has an ID. Jupyter v4.5+ uses UUID cell IDs.
   */
  private ensureCellId(cell: NotebookCell): string {
    if (!cell.id) {
      cell.id = randomUUID();
    }
    return cell.id;
  }

  /**
   * Get a preview of cell source for output formatting.
   */
  private getSourcePreview(cell: NotebookCell | null): string {
    if (!cell) return '(deleted)';

    const source = typeof cell.source === 'string'
      ? cell.source
      : (cell.source ?? []).join('');

    if (source.length <= SOURCE_PREVIEW_MAX) return source;
    return source.slice(0, SOURCE_PREVIEW_MAX) + '...';
  }
}
