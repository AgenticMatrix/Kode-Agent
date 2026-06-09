/**
 * HookManager — Stub implementation for ink-chat-tui.
 *
 * Provides the interface expected by query.ts (PreMessage, Stop, etc.)
 * without any actual hook execution. All methods are no-ops that return
 * the default "not blocked" result.
 */

export class HookManager {
  async onSetup(..._args: unknown[]): Promise<void> {}
  async onConfigChange(..._args: unknown[]): Promise<void> {}

  async onUserPromptSubmit(..._args: unknown[]): Promise<{ blocked: boolean; blockReason?: string; augmentedPrompt?: string }> {
    return { blocked: false };
  }
  async onUserPromptExpansion(..._args: unknown[]): Promise<{ blocked: boolean; blockReason?: string; expandedPromptOverride?: string }> {
    return { blocked: false };
  }
  async onPreMessage(..._args: unknown[]): Promise<{ blocked: boolean; blockReason?: string | undefined; modifiedSystemPrompt?: string | undefined; injectContext?: string | undefined }> {
    return { blocked: false };
  }
  async onPostMessage(..._args: unknown[]): Promise<{ saveToMemory?: boolean }> {
    return {};
  }
  async onStop(..._args: unknown[]): Promise<{ shouldStop: boolean }> {
    return { shouldStop: false };
  }
  async onStopFailure(..._args: unknown[]): Promise<void> {}
  async onPermissionRequest(..._args: unknown[]): Promise<{ permissionOverride?: 'auto-approve' | 'auto-deny' | undefined }> {
    return {};
  }
  async onPermissionDenied(..._args: unknown[]): Promise<void> {}
  async onPreToolUse(..._args: unknown[]): Promise<{ blocked: boolean; reason?: string }> {
    return { blocked: false };
  }
  async onPostToolUse(..._args: unknown[]): Promise<void> {}
  async onPostToolUseFailure(..._args: unknown[]): Promise<void> {}
  async onPostToolBatch(..._args: unknown[]): Promise<void> {}
  async onPreCompact(..._args: unknown[]): Promise<{ injectContext: string }> {
    return { injectContext: '' };
  }
  async onPostCompact(..._args: unknown[]): Promise<void> {}
  async onNotification(..._args: unknown[]): Promise<void> {}
}
