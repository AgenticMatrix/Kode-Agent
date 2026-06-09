/**
 * CheckpointManager — Stub implementation.
 *
 * No git checkpointing yet for ink-chat-tui. All methods are no-ops
 * that return sensible defaults.
 */

export class CheckpointManager {
  async create(_options?: { sessionId: string; cwd: string; description: string }): Promise<string | null> {
    return null;
  }

  async createCheckpoint(): Promise<string | null> {
    return null;
  }

  async restoreCheckpoint(): Promise<boolean> {
    return false;
  }

  async autoCreate(_options: {
    sessionId: string;
    turnNumber: number;
    toolName: string;
    filePath: string;
    cwd: string;
    readAfter?: boolean;
  }): Promise<void> {
    // No-op
  }

  loadFromDisk(_sessionId: string): void {
    // No-op
  }
}
