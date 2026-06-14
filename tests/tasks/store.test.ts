import { describe, expect, it, beforeEach } from 'vitest';
import { createTask, getTask, listTasks, updateTask, resetStore } from '../../src/tasks/store.js';

describe('Task store', () => {
  beforeEach(async () => {
    await resetStore();
  });

  describe('createTask', () => {
    it('should create a task with auto-increment ID', async () => {
      const t1 = await createTask({ subject: 'Task 1', description: 'First task' });
      const t2 = await createTask({ subject: 'Task 2', description: 'Second task' });

      expect(t1.id).toBe('1');
      expect(t2.id).toBe('2');
      expect(t1.status).toBe('pending');
      expect(t2.status).toBe('pending');
    });

    it('should set createdAt and updatedAt', async () => {
      const before = Date.now();
      const task = await createTask({ subject: 'Test', description: 'Desc' });
      expect(task.createdAt).toBeGreaterThanOrEqual(before);
      expect(task.updatedAt).toBeGreaterThanOrEqual(before);
    });

    it('should store metadata', async () => {
      const task = await createTask({
        subject: 'Test',
        description: 'Desc',
        metadata: { priority: 'high' },
      });
      expect(task.metadata.priority).toBe('high');
    });
  });

  describe('getTask', () => {
    it('should retrieve a task by ID', async () => {
      const task = await createTask({ subject: 'Test', description: 'Desc' });
      const retrieved = await getTask(task.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.subject).toBe('Test');
    });

    it('should return null for non-existent ID', async () => {
      expect(await getTask('nonexistent')).toBeNull();
    });
  });

  describe('listTasks', () => {
    it('should list all non-deleted tasks', async () => {
      await createTask({ subject: 'T1', description: 'D1' });
      await createTask({ subject: 'T2', description: 'D2' });
      const tasks = await listTasks();
      expect(tasks).toHaveLength(2);
    });

    it('should exclude deleted tasks', async () => {
      const task = await createTask({ subject: 'T1', description: 'D1' });
      await updateTask(task.id, { status: 'deleted' });
      const tasks = await listTasks();
      expect(tasks).toHaveLength(0);
    });
  });

  describe('updateTask', () => {
    it('should update subject', async () => {
      const task = await createTask({ subject: 'Old', description: 'Desc' });
      const result = await updateTask(task.id, { subject: 'New' });
      expect('error' in result).toBe(false);
      if ('task' in result) {
        expect(result.task.subject).toBe('New');
        expect(result.updatedFields).toContain('subject');
      }
    });

    it('should update status', async () => {
      const task = await createTask({ subject: 'Test', description: 'Desc' });
      const result = await updateTask(task.id, { status: 'in_progress' });
      if ('task' in result) {
        expect(result.task.status).toBe('in_progress');
      }
    });

    it('should mark task as deleted', async () => {
      const task = await createTask({ subject: 'Test', description: 'Desc' });
      const result = await updateTask(task.id, { status: 'deleted' });
      if ('task' in result) {
        expect(result.task.status).toBe('deleted');
      }
    });

    it('should return error for unknown task', async () => {
      const result = await updateTask('nonexistent', { subject: 'New' });
      expect('error' in result).toBe(true);
    });

    it('should establish dependency chains', async () => {
      const t1 = await createTask({ subject: 'Task 1', description: 'First' });
      const t2 = await createTask({ subject: 'Task 2', description: 'Second' });

      await updateTask(t1.id, { addBlocks: [t2.id] });

      const updatedT1 = await getTask(t1.id);
      const updatedT2 = await getTask(t2.id);

      expect(updatedT1).toBeDefined();
      expect(updatedT2).toBeDefined();
      expect(updatedT1!.blocks).toContain(t2.id);
      expect(updatedT2!.blockedBy).toContain(t1.id);
    });

    it('should not add duplicate dependencies', async () => {
      const t1 = await createTask({ subject: 'T1', description: 'D1' });
      const t2 = await createTask({ subject: 'T2', description: 'D2' });

      await updateTask(t1.id, { addBlocks: [t2.id] });
      await updateTask(t1.id, { addBlocks: [t2.id] });

      const updated = await getTask(t1.id);
      expect(updated).toBeDefined();
      expect(updated!.blocks.filter((b: string) => b === t2.id)).toHaveLength(1);
    });

    it('should not allow self-dependency', async () => {
      const t1 = await createTask({ subject: 'T1', description: 'D1' });
      await updateTask(t1.id, { addBlocks: [t1.id] });
      const updated = await getTask(t1.id);
      expect(updated).toBeDefined();
      expect(updated!.blocks).not.toContain(t1.id);
    });

    it('should clear references when a task is deleted', async () => {
      const t1 = await createTask({ subject: 'T1', description: 'D1' });
      const t2 = await createTask({ subject: 'T2', description: 'D2' });

      await updateTask(t1.id, { addBlocks: [t2.id] });
      await updateTask(t2.id, { status: 'deleted' });

      const updated = await getTask(t1.id);
      expect(updated).toBeDefined();
      expect(updated!.blocks).not.toContain(t2.id);
    });
  });

  describe('resetStore', () => {
    it('should clear all tasks and reset counter', async () => {
      await createTask({ subject: 'T1', description: 'D1' });
      await resetStore();
      const t2 = await createTask({ subject: 'T2', description: 'D2' });
      expect(t2.id).toBe('1'); // counter reset
    });
  });
});
