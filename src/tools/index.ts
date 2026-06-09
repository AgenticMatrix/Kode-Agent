/**
 * Tools — public API.
 *
 * To add a new tool:
 *   1. Create tools/<name>/ with schema.ts, executor.ts, renderer.tsx, index.ts
 *   2. Import and register in registry.ts
 *
 * To remove a tool:
 *   1. Delete its directory
 *   2. Remove from registry.ts plugin array
 */

export {
  getAnthropicTools,
  getToolMeta,
  getToolRiskLevel,
  executeTool,
  hasExecutor,
  getToolUseRenderer,
  getToolResultRenderer,
} from './registry.js';

export type {
  ToolPlugin,
  ToolMeta,
  ToolSchema,
  ToolExecutor,
  ToolResult,
  ExecutorOptions,
  ToolUseRenderer,
  ToolResultRenderer,
  ToolUseRendererProps,
  ToolResultRendererProps,
} from './types.js';

export { BaseToolRenderer } from './base/BaseToolRenderer.js';
export { BaseToolResultRenderer } from './base/BaseToolResultRenderer.js';
export { GenericToolRenderer, GenericToolResultRenderer } from './base/GenericRenderer.js';

// Shared primitives — reusable by any tool's renderer
export { OutputLine } from './shared/OutputLine.js';
export type { OutputLineProps } from './shared/OutputLine.js';
export { ShellTimeDisplay, formatDuration } from './shared/ShellTimeDisplay.js';
export type { ShellTimeDisplayProps } from './shared/ShellTimeDisplay.js';
export { ToolResultCard } from './shared/ToolResultCard.js';
export type { ToolResultCardProps } from './shared/ToolResultCard.js';
