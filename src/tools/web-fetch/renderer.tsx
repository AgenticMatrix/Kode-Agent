import { BaseToolRenderer } from '../base/BaseToolRenderer.js';
import type { ToolUseRendererProps } from '../types.js';

export function WebFetchRenderer(props: ToolUseRendererProps) {
  return <BaseToolRenderer {...props}>{null}</BaseToolRenderer>;
}
