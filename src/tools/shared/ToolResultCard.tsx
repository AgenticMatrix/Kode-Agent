import React from 'react';
import { Box, Text } from 'ink';
import { ShellTimeDisplay } from './ShellTimeDisplay.js';

export interface ToolResultCardProps {
  toolName?: string;
  duration?: number;
  isError?: boolean;
  children: React.ReactNode;
}

/** Tool icons shared across use and result renderers. */
const TOOL_ICONS: Record<string, string> = {
  bash: '⚡',
  read: '📖',
  write: '✏️',
  edit: '✏️',
  glob: '🔍',
  grep: '🔎',
  'web-fetch': '🌐',
  'web-search': '🔎',
  'todo-write': '📋',
  default: '🔧',
};

/**
 * Optional wrapper card for tool result renderers.
 *
 * Lighter than `BaseToolRenderer` (which wraps tool-use blocks):
 *   - Single-border box (red on error, dim on success)
 *   - Header: tool icon + name (left), duration badge (right)
 *   - Content area: renders children with padding
 */
export function ToolResultCard({
  toolName,
  duration,
  isError,
  children,
}: ToolResultCardProps): React.ReactNode {
  const borderColor = isError ? 'red' : 'grey';
  const icon = toolName ? (TOOL_ICONS[toolName] ?? TOOL_ICONS.default) : '';
  const label = toolName ?? '';

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={borderColor}
      borderDimColor
      paddingX={1}
    >
      {/* Header row: icon + name | duration */}
      {(label || duration !== undefined) ? (
        <Box flexDirection="row" justifyContent="space-between">
          <Box marginRight={1}>
            {label ? (
              <Text dimColor>
                {icon} <Text dimColor>{label}</Text>
              </Text>
            ) : null}
          </Box>
          {duration !== undefined ? (
            <ShellTimeDisplay durationMs={duration} />
          ) : null}
        </Box>
      ) : null}

      {/* Content */}
      <Box paddingLeft={1} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
}
