import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CheckpointManager } from '../checkpoint.js';

describe('CheckpointManager', () => {
  let manager: CheckpointManager;
  let sessionId: string;

  beforeEach(() => {
    manager = new CheckpointManager();
    // Use a unique session ID per test to avoid disk persistence conflicts
    sessionId = `test-${randomUUID()}`;
  });

  describe('create', () => {
    it('should create a checkpoint with an ID', async () => {
      const cp = await manager.create({
        sessionId,
        cwd: '/tmp',
        description: 'Test checkpoint',
      });
      expect(cp.id).toBeDefined();
      expect(cp.sessionId).toBe(sessionId);
      expect(cp.description).toBe('Test checkpoint');
      expect(cp.createdAt).toBeDefined();
    });

    it('should use default description when not provided', async () => {
      const cp = await manager.create({
        sessionId,
        cwd: '/tmp',
      });
      expect(cp.description).toContain('Checkpoint');
    });

    it('should store checkpoint in memory', async () => {
      const cp = await manager.create({
        sessionId,
        cwd: '/tmp',
      });
      const retrieved = manager.list(sessionId);
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0]!.id).toBe(cp.id);
    });
  });

  describe('list', () => {
    it('should list checkpoints for a specific session', async () => {
      const s1Id = `s1-${randomUUID()}`;
      const s2Id = `s2-${randomUUID()}`;

      await manager.create({ sessionId: s1Id, cwd: '/tmp' });
      await manager.create({ sessionId: s1Id, cwd: '/tmp' });
      await manager.create({ sessionId: s2Id, cwd: '/tmp' });

      const s1Checkpoints = manager.list(s1Id);
      expect(s1Checkpoints).toHaveLength(2);

      const s2Checkpoints = manager.list(s2Id);
      expect(s2Checkpoints).toHaveLength(1);
    });

    it('should sort by createdAt descending (newest first)', async () => {
      await manager.create({ sessionId, cwd: '/tmp' });
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));
      await manager.create({ sessionId, cwd: '/tmp' });

      const list = manager.list(sessionId);
      expect(list.length).toBeGreaterThanOrEqual(2);
      expect(new Date(list[0]!.createdAt).getTime())
        .toBeGreaterThanOrEqual(new Date(list[1]!.createdAt).getTime());
    });

    it('should return empty array for unknown session', () => {
      expect(manager.list('nonexistent-' + randomUUID())).toEqual([]);
    });
  });

  describe('restore', () => {
    it('should fail for non-existent checkpoint', async () => {
      const result = await manager.restore('nonexistent', '/tmp');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Checkpoint not found');
    });
  });

  describe('loadFromDisk', () => {
    it('should return empty array when no disk data exists', () => {
      const loaded = manager.loadFromDisk('nonexistent-' + randomUUID());
      expect(loaded).toEqual([]);
    });
  });
});
