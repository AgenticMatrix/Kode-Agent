import { Text } from 'ink';
import { BaseToolRenderer } from '../base/BaseToolRenderer.js';
import type { ToolUseRendererProps } from '../types.js';

export function GlobRenderer(props: ToolUseRendererProps) {
  return (
    <BaseToolRenderer {...props}>
      <Text dimColor>Searching for matching files</Text>
    </BaseToolRenderer>
  );
}
