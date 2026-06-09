import { Text } from 'ink';
import { BaseToolRenderer } from '../base/BaseToolRenderer.js';
import type { ToolUseRendererProps } from '../types.js';

export function GrepRenderer(props: ToolUseRendererProps) {
  return (
    <BaseToolRenderer {...props}>
      <Text dimColor>Searching for content matches</Text>
    </BaseToolRenderer>
  );
}
