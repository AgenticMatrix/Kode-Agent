import { Text } from 'ink';
import { BaseToolRenderer } from '../base/BaseToolRenderer.js';
import type { ToolUseRendererProps } from '../types.js';

export function EditRenderer(props: ToolUseRendererProps) {
  return (
    <BaseToolRenderer {...props}>
      <Text dimColor>Replacing text in file</Text>
    </BaseToolRenderer>
  );
}
