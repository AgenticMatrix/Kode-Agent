import { Box, Text } from 'ink';
import type { ToolUseRendererProps } from '../types.js';

const STATE_ICON: Record<string, string> = {
  pending: '⬜',
  executing: '⏳',
  done: '✅',
  error: '❌',
};

const STATE_LABEL: Record<string, string> = {
  pending: 'pending',
  executing: 'running…',
  done: 'done',
  error: 'error',
};

const RISK_COLOR: Record<string, string> = {
  safe: 'green',
  mutation: 'yellow',
  destructive: 'red',
};

const TOOL_ICONS: Record<string, string> = {
  read: '📖',
  write: '✏️',
  edit: '✏️',
  bash: '⚡',
  glob: '🔍',
  grep: '🔎',
  'web-fetch': '🌐',
  'web-search': '🔎',
  'todo-write': '📋',
  'task-create': '📝',
  'task-update': '📝',
  'agent-spawn': '🧭',
  'agent-stop': '🛑',
  'agent-message': '💬',
  skill: '⚡',
  cron: '⏰',
  lsp: '🔍',
  default: '🔧',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Common base for all tool-use renderers.
 *
 * Renders a colour-coded card with:
 *  - status icon + tool icon + tool name + parameter summary
 *  - duration badge
 *  - permission state tag
 *  - collapsible body (children)
 */
export function BaseToolRenderer({
  toolName,
  paramSummary,
  state,
  riskLevel,
  permissionState,
  duration,
  expanded = true,
  children,
}: ToolUseRendererProps) {
  const borderColor = riskLevel ? RISK_COLOR[riskLevel] : 'grey';
  const icon = TOOL_ICONS[toolName] ?? TOOL_ICONS.default;
  const statusIcon = STATE_ICON[state];
  const statusLabel = STATE_LABEL[state];

  return (
    <Box
      flexDirection="column"
      marginBottom={1}
    >
      {/* Title bar */}
      <Box flexDirection="row" justifyContent="space-between">
        <Box marginRight={1}>
          <Text>
            <Text color={borderColor}>{statusIcon} </Text>
            <Text bold color={borderColor}>
              {icon} {toolName}
            </Text>
            {paramSummary ? (
              <Text dimColor> · {paramSummary}</Text>
            ) : null}
            {state === 'executing' ? (
              <Text dimColor color="yellow"> ({statusLabel})</Text>
            ) : null}
          </Text>
        </Box>

        <Box>
          {duration !== undefined && state === 'done' ? (
            <Text dimColor>⏱ {formatDuration(duration)}</Text>
          ) : null}
          {permissionState === 'denied' ? (
            <Text color="red"> ⛔ denied</Text>
          ) : permissionState === 'pending' ? (
            <Text color="yellow"> ⚠ pending</Text>
          ) : null}
        </Box>
      </Box>

      {/* Body */}
      {expanded && children ? (
        <Box paddingLeft={2} flexDirection="column" marginTop={0}>
          {children}
        </Box>
      ) : null}
    </Box>
  );
}
