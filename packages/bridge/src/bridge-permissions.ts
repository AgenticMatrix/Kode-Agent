import type { BridgeState } from './bridge-state.js';

export function resolveApproval(
  state: BridgeState,
  toolUseId: string,
  allowed: boolean,
): string | null {
  const idx = state.pendingApprovals.findIndex((a) => a.toolUseId === toolUseId);
  if (idx === -1) return null;

  const approval = state.pendingApprovals[idx]!;
  state.pendingApprovals.splice(idx, 1);

  approval.deferred.resolve(allowed);

  return approval.toolName;
}
