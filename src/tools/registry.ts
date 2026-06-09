import type Anthropic from '@anthropic-ai/sdk';

import type { ToolPlugin, ToolMeta, ToolExecutor, ToolUseRenderer, ToolResultRenderer, ToolResult, ExecutorOptions } from './types.js';
import { GenericToolRenderer, GenericToolResultRenderer } from './base/GenericRenderer.js';

// ── Plugin imports (add new tools here) ────────────────────────────────
import bashPlugin from './bash/index.js';
import readPlugin from './read/index.js';
import writePlugin from './write/index.js';
import editPlugin from './edit/index.js';
import globPlugin from './glob/index.js';
import grepPlugin from './grep/index.js';
import webFetchPlugin from './web-fetch/index.js';
import webSearchPlugin from './web-search/index.js';
import todoWritePlugin from './todo-write/index.js';
import taskCreatePlugin from './task-create/index.js';
import taskUpdatePlugin from './task-update/index.js';
import taskListPlugin from './task-list/index.js';
import taskGetPlugin from './task-get/index.js';

// ── Known tool names (for tools without executors yet) ─────────────────
const KNOWN_TOOL_NAMES: string[] = [
  'notebook-edit', 'git', 'powershell',
  'agent-spawn', 'agent-stop', 'agent-message', 'agent-read',
  'task-output', 'task-describe',
  'ask-user-question', 'exit-plan-mode',
  'skill',
  'cron-create', 'cron-delete', 'cron-list',
  'enter-worktree', 'exit-worktree',
  'lsp',
];

// ── Plugin registration ────────────────────────────────────────────────

export const plugins: ToolPlugin[] = [
  bashPlugin,
  readPlugin,
  writePlugin,
  editPlugin,
  globPlugin,
  grepPlugin,
  webFetchPlugin,
  webSearchPlugin,
  todoWritePlugin,
  taskCreatePlugin,
  taskUpdatePlugin,
  taskListPlugin,
  taskGetPlugin,
];

// Build lookup tables
const schemaByName = new Map<string, ToolPlugin['schema']>();
const executorByName = new Map<string, ToolExecutor>();
const useRendererByName = new Map<string, ToolUseRenderer>();
const resultRendererByName = new Map<string, ToolResultRenderer>();

for (const p of plugins) {
  schemaByName.set(p.name, p.schema);
  executorByName.set(p.name, p.executor);
  if (p.useRenderer) useRendererByName.set(p.name, p.useRenderer);
  if (p.resultRenderer) resultRendererByName.set(p.name, p.resultRenderer);
}

// Pre-populate renderers for known (executor-less) tool names
for (const name of KNOWN_TOOL_NAMES) {
  useRendererByName.set(name, GenericToolRenderer);
  resultRendererByName.set(name, GenericToolResultRenderer);
}

// ── Public API ─────────────────────────────────────────────────────────

/** Extract pure Anthropic tool definitions (strip _meta). */
export function getAnthropicTools(): Anthropic.Tool[] {
  return Array.from(schemaByName.values()).map(({ _meta: _, ...tool }) => tool);
}

/** Get tool metadata by name. */
export function getToolMeta(toolName: string): ToolMeta | undefined {
  return schemaByName.get(toolName)?._meta;
}

/** Get risk level for a tool by name. */
export function getToolRiskLevel(toolName: string): ToolMeta['riskLevel'] {
  return getToolMeta(toolName)?.riskLevel ?? 'safe';
}

const EXECUTOR_DEFAULTS: Required<ExecutorOptions> = {
  cwd: process.cwd(),
  allowMutation: true,
  maxOutput: 50_000,
  bashTimeout: 30_000,
};

/**
 * Execute a tool by name with the given input.
 * Returns a ToolResult with content and isError flag.
 */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  options?: ExecutorOptions,
): Promise<ToolResult> {
  const opts: Required<ExecutorOptions> = { ...EXECUTOR_DEFAULTS, ...options };
  const fn = executorByName.get(toolName);

  if (!fn) {
    return {
      content: `Unknown tool: ${toolName}. Available: ${[...executorByName.keys()].join(', ')}`,
      isError: true,
    };
  }

  try {
    return await fn(input, opts);
  } catch (err) {
    return {
      content: `Tool execution error: ${(err as Error).message}`,
      isError: true,
    };
  }
}

/** Check if a tool name has an executor registered. */
export function hasExecutor(toolName: string): boolean {
  return executorByName.has(toolName);
}

/** Look up a tool-use renderer by name. Falls back to GenericToolRenderer. */
export function getToolUseRenderer(toolName: string): ToolUseRenderer {
  return useRendererByName.get(toolName) ?? GenericToolRenderer;
}

/** Look up a tool-result renderer by name. Falls back to GenericToolResultRenderer. */
export function getToolResultRenderer(toolName: string): ToolResultRenderer {
  return resultRendererByName.get(toolName) ?? GenericToolResultRenderer;
}
