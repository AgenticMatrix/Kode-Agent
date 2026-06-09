export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted';

export interface Task {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  owner?: string;
  status: TaskStatus;
  /** IDs of tasks that this task blocks. */
  blocks: string[];
  /** IDs of tasks that block this task. */
  blockedBy: string[];
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface CreateTaskInput {
  subject: string;
  description: string;
  activeForm?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateTaskInput {
  subject?: string;
  description?: string;
  activeForm?: string;
  status?: TaskStatus;
  owner?: string;
  addBlocks?: string[];
  addBlockedBy?: string[];
  metadata?: Record<string, unknown>;
}

let counter = 0;
const tasks = new Map<string, Task>();

export function createTask(input: CreateTaskInput): Task {
  counter++;
  const id = String(counter);
  const now = Date.now();
  const task: Task = {
    id,
    subject: input.subject,
    description: input.description,
    activeForm: input.activeForm,
    status: 'pending',
    blocks: [],
    blockedBy: [],
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  };
  tasks.set(id, task);
  return task;
}

export function getTask(id: string): Task | undefined {
  return tasks.get(id);
}

export function listTasks(): Task[] {
  return Array.from(tasks.values()).filter((t) => t.status !== 'deleted');
}

export function updateTask(id: string, input: UpdateTaskInput): { task: Task; updatedFields: string[] } | { error: string } {
  const task = tasks.get(id);
  if (!task) return { error: `Task #${id} not found` };

  const updatedFields: string[] = [];

  if (input.status === 'deleted') {
    task.status = 'deleted';
    task.updatedAt = Date.now();
    updatedFields.push('status');
    // Remove references from dependency chains
    for (const t of tasks.values()) {
      t.blockedBy = t.blockedBy.filter((bid) => bid !== id);
      t.blocks = t.blocks.filter((bid) => bid !== id);
    }
    return { task, updatedFields };
  }

  if (input.subject !== undefined && input.subject !== task.subject) {
    task.subject = input.subject;
    updatedFields.push('subject');
  }
  if (input.description !== undefined && input.description !== task.description) {
    task.description = input.description;
    updatedFields.push('description');
  }
  if (input.activeForm !== undefined) {
    task.activeForm = input.activeForm;
    updatedFields.push('activeForm');
  }
  if (input.status !== undefined && input.status !== task.status) {
    task.status = input.status as TaskStatus;
    updatedFields.push('status');
  }
  if (input.owner !== undefined && input.owner !== task.owner) {
    task.owner = input.owner;
    updatedFields.push('owner');
  }
  if (input.metadata !== undefined) {
    task.metadata = { ...task.metadata, ...input.metadata };
    updatedFields.push('metadata');
  }

  // Handle dependencies
  if (input.addBlocks) {
    for (const blockedId of input.addBlocks) {
      if (!task.blocks.includes(blockedId) && blockedId !== id) {
        task.blocks.push(blockedId);
        // Set up reverse dependency
        const blocked = tasks.get(blockedId);
        if (blocked && !blocked.blockedBy.includes(id)) {
          blocked.blockedBy.push(id);
        }
      }
    }
    updatedFields.push('blocks');
  }

  if (input.addBlockedBy) {
    for (const blockerId of input.addBlockedBy) {
      if (!task.blockedBy.includes(blockerId) && blockerId !== id) {
        task.blockedBy.push(blockerId);
        // Set up reverse dependency
        const blocker = tasks.get(blockerId);
        if (blocker && !blocker.blocks.includes(id)) {
          blocker.blocks.push(id);
        }
      }
    }
    updatedFields.push('blockedBy');
  }

  task.updatedAt = Date.now();
  return { task, updatedFields };
}

/** Reset the store (for testing / session restart). */
export function resetStore(): void {
  counter = 0;
  tasks.clear();
}
