/**
 * deferred.ts — Deferred Permission Resolution
 *
 * When the Agent Loop encounters a tool that needs user confirmation
 * (permission.behavior === 'ask_user'), it creates a DeferredPermission
 * and yields a permission_required message. The TUI displays an approval
 * overlay. When the user responds, resolvePermission() resolves the
 * deferred promise, unblocking the Agent Loop.
 *
 * @deprecated For the TypeScript QueryEngine backend (KodeGatewayClient),
 *   this module's global `pendingPermissions` Map is NOT used. The Agent
 *   Loop (query.ts) creates DeferredPermission objects INLINE without
 *   registering them here. Instead, query-bridge.ts stores them in
 *   `bridgeState.pendingApprovals` and kode-client.ts resolves them via
 *   `approval.deferred.resolve(allowed)`. Calling resolvePermission() from
 *   this module against a QueryEngine-created permission is a silent no-op.
 *
 *   This module remains for:
 *   1. The Python gateway backend path (GatewayClient spawns Python child)
 *   2. Future standalone TUI modes needing simple permission resolution
 *   3. Third-party consumers that use deferred.ts directly
 */

import type { DeferredPermission } from '@kode/shared';

// ---------------------------------------------------------------------------
// Pending Permissions Registry
// ---------------------------------------------------------------------------

const pendingPermissions = new Map<string, DeferredPermission>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a deferred permission that the Agent Loop will await.
 *
 * - Returns immediately with the DeferredPermission object
 * - The Agent Loop yields this object and then `await deferred.promise`
 * - The TUI resolves it via `resolvePermission(toolUseId, allowed)`
 * - Auto-denies after `timeoutMs` (default 30s)
 */
export function createDeferredPermission(
  toolName: string,
  command: string,
  description: string,
  toolUseId: string,
  timeoutMs = 30000,
): DeferredPermission {
  let resolve!: (allowed: boolean) => void;
  const promise = new Promise<boolean>((res) => {
    resolve = res;
  });

  const deferred: DeferredPermission = {
    toolName,
    command,
    description,
    toolUseId,
    resolve,
    promise,
  };

  pendingPermissions.set(toolUseId, deferred);

  // Auto-deny on timeout to prevent Agent Loop from hanging forever
  setTimeout(() => {
    if (pendingPermissions.has(toolUseId)) {
      deferred.resolve(false);
      pendingPermissions.delete(toolUseId);
    }
  }, timeoutMs);

  return deferred;
}

/**
 * Resolve a pending permission from outside the Agent Loop (e.g. TUI).
 *
 * @param toolUseId - The tool_use block ID
 * @param allowed - true = user approved, false = user denied
 */
export function resolvePermission(toolUseId: string, allowed: boolean): void {
  const deferred = pendingPermissions.get(toolUseId);
  if (deferred) {
    deferred.resolve(allowed);
    pendingPermissions.delete(toolUseId);
  }
}

/**
 * Get the map of currently pending permissions.
 * Useful for status display or debugging.
 */
export function getPendingPermissions(): Map<string, DeferredPermission> {
  return pendingPermissions;
}
