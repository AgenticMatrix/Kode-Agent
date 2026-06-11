import React from 'react';
import type { ToolResultRendererProps } from '../../tools/types.js';

export function AgentSpawnResultRenderer(_props: ToolResultRendererProps): React.ReactNode {
  // Result is rendered inline inside AgentSpawnRenderer — no separate box needed.
  return null;
}
