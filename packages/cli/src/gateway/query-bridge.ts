/**
 * query-bridge.ts — Re-export from @coder/bridge
 *
 * The bridge logic has been extracted to @coder/bridge so both the CLI (TUI)
 * and the VS Code extension can share the same Agent Loop → UI event
 * translation layer.
 */
export {
  createBridgeState,
  bridgeQueryToGateway,
  resetTurnState,
  resolveApproval,
} from '@coder/bridge'
export type {
  BridgeState,
  BridgeUsage,
  ActiveToolState,
  PendingApproval,
} from '@coder/bridge'
