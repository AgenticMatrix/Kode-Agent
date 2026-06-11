import { describe, expect, it, beforeEach } from 'vitest';
import { createTask, getTask, listTasks, updateTask, resetStore } from '../../src/tasks/store.js';

describe('Task store', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('createTask', () => {
    it('should create a task with auto-increment ID', () => {
      const t1 = createTask({ subject: 'Task 1', description: 'First task' });
      const t2 = createTask({ subject: 'Task 2', description: 'Second task' });

      expect(t1.id).toBe('1');
      expect(t2.id).toBe('2');
      expect(t1.status).toBe('pending');
      expect(t2.status).toBe('pending');
    });

    it('should set createdAt and updatedAt', () => {
      const before = Date.now();
      const task = createTask({ subject: 'Test', description: 'Desc' });
      expect(task.createdAt).toBeGreaterThanOrEqual(before);
      expect(task.updatedAt).toBeGreaterThanOrEqual(before);
    });

    it('should store metadata', () => {
      const task = createTask({
        subject: 'Test',
        description: 'Desc',
        metadata: { priority: 'high' },
      });
      expect(task.metadata.priority).toBe('high');
    });
  });

  describe('getTask', () => {
    it('should retrieve a task by ID', () => {
      const task = createTask({ subject: 'Test', description: 'Desc' });
      const retrieved = getTask(task.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.subject).toBe('Test');
    });

    it('should return undefined for non-existent ID', () => {
      expect(getTask('nonexistent')).toBeUndefined();
    });
  });

  describe('listTasks', () => {
    it('should list all non-deleted tasks', () => {
      createTask({ subject: 'T1', description: 'D1' });
      createTask({ subject: 'T2', description: 'D2' });
      expect(listTasks()).toHaveLength(2);
    });

    it('should exclude deleted tasks', () => {
      const task = createTask({ subject: 'T1', description: 'D1' });
      updateTask(task.id, { status: 'deleted' });
      expect(listTasks()).toHaveLength(0);
    });
  });

  describe('updateTask', () => {
    it('should update subject', () => {
      const task = createTask({ subject: 'Old', description: 'Desc' });
      const result = updateTask(task.id, { subject: 'New' });
      expect('error' in result).toBe(false);
      if ('task' in result) {
        expect(result.task.subject).toBe('New');
        expect(result.updatedFields).toContain('subject');
      }
    });

    it('should update status', () => {
      const task = createTask({ subject: 'Test', description: 'Desc' });
      const result = updateTask(task.id, { status: 'in_progress' });
      if ('task' in result) {
        expect(result.task.status).toBe('in_progress');
      }
    });

    it('should mark task as deleted', () => {
      const task = createTask({ subject: 'Test', description: 'Desc' });
      const result = updateTask(task.id, { status: 'deleted' });
      if ('task' in result) {
        expect(result.task.status).toBe('deleted');
      }
    });

    it('should return error for unknown task', () => {
      const result = updateTask('nonexistent', { subject: 'New' });
      expect('error' in result).toBe(true);
    });

    it('should establish dependency chains', () => {
      const t1 = createTask({ subject: 'Task 1', description: 'First' });
      const t2 = createTask({ subject: 'Task 2', description: 'Second' });

      updateTask(t1.id, { addBlocks: [t2.id] });

      const updatedT1 = getTask(t1.id)!;
      const updatedT2 = getTask(t2.id)!;

      expect(updatedT1.blocks).toContain(t2.id);
      expect(updatedT2.blockedBy).toContain(t1.id);
    });

    it('should not add duplicate dependencies', () => {
      const t1 = createTask({ subject: 'T1', description: 'D1' });
      const t2 = createTask({ subject: 'T2', description: 'D2' });

      updateTask(t1.id, { addBlocks: [t2.id] });
      updateTask(t1.id, { addBlocks: [t2.id] });

      const updated = getTask(t1.id)!;
      expect(updated.blocks.filter(b => b === t2.id)).toHaveLength(1);
    });

    it('should not allow self-dependency', () => {
      const t1 = createTask({ subject: 'T1', description: 'D1' });
      updateTask(t1.id, { addBlocks: [t1.id] });
      expect(getTask(t1.id)!.blocks).not.toContain(t1.id);
    });

    it('should clear references when a task is deleted', () => {
      const t1 = createTask({ subject: 'T1', description: 'D1' });
      const t2 = createTask({ subject: 'T2', description: 'D2' });

      updateTask(t1.id, { addBlocks: [t2.id] });
      updateTask(t2.id, { status: 'deleted' });

      expect(getTask(t1.id)!.blocks).not.toContain(t2.id);
    });
  });

  describe('resetStore', () => {
    it('should clear all tasks and reset counter', () => {
      createTask({ subject: 'T1', description: 'D1' });
      resetStore();
      const t2 = createTask({ subject: 'T2', description: 'D2' });
      expect(t2.id).toBe('1'); // counter reset
    });
  });
});
