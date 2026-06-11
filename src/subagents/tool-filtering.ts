/**
 * Tool allow/deny lists for sub-agent tool filtering.
 *
 * Three-layer filtering:
 *   Layer 1: ALL_AGENT_DISALLOWED_TOOLS — always stripped from sub-agents
 *   Layer 2: ASYNC_AGENT_ALLOWED_TOOLS — whitelist for explore-type agents
 *   Layer 3: IN_PROCESS_TEAMMATE_ALLOWED_TOOLS — extra tools for general-purpose/plan agents
 */

import type { ToolDefinition } from '../core/types.js';
import { ASYNC_AGENT_ALLOWED_TOOLS } from './explore/tool-filtering.js';

/** Always removed from sub-agent tool sets. Enforces depth-limit=1. */
export const ALL_AGENT_DISALLOWED_TOOLS = new Set([
  'agent-spawn',
  'agent-message',
  'agent-stop',
  'agent-read',
  'ask-user-question',
  'task-stop',
  'task-output',
  'exit-plan-mode',
  'enter-plan-mode',
  'cron-create',
  'cron-delete',
  'cron-list',
  'enter-worktree',
  'exit-worktree',
]);

export type SubagentType = 'explore' | 'plan' | 'general-purpose';

export function filterToolsForAgent(
  parentTools: ToolDefinition[],
  agentType: SubagentType,
): ToolDefinition[] {
  let filtered = parentTools.filter(t => !ALL_AGENT_DISALLOWED_TOOLS.has(t.name));

  if (agentType === 'explore') {
    filtered = filtered.filter(t => ASYNC_AGENT_ALLOWED_TOOLS.has(t.name));
  }

  return filtered;
}
