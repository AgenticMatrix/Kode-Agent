import { mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { ensureLockFile, lock } from './lock.js';
import {
  type ClaimTaskOptions,
  type ClaimTaskResult,
  type CreateTaskInput,
  type Task,
  type TaskStatus,
  type UpdateTaskInput,
  validateTask,
} from './schema.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const TASKS_BASE_DIR = join(homedir(), '.coder', 'tasks');
const HIGH_WATER_MARK_FILE = '.highwatermark';

function getTaskListDir(taskListId: string): string {
  return join(TASKS_BASE_DIR, sanitize(taskListId));
}

function getTaskPath(taskListId: string, taskId: string): string {
  return join(getTaskListDir(taskListId), `${sanitize(taskId)}.json`);
}

function getLockPath(taskListId: string): string {
  return join(getTaskListDir(taskListId), '.lock');
}

function getHighWaterMarkPath(taskListId: string): string {
  return join(getTaskListDir(taskListId), HIGH_WATER_MARK_FILE);
}

function sanitize(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, '-');
}

// ---------------------------------------------------------------------------
// Session ID
// ---------------------------------------------------------------------------

let currentTaskListId = 'default';

export function setTaskListId(id: string): void {
  currentTaskListId = id;
}

export function getTaskListId(): string {
  return process.env.CODER_TASK_LIST_ID || currentTaskListId;
}

// ---------------------------------------------------------------------------
// V1 / V2 switch
// ---------------------------------------------------------------------------

/**
 * Whether the V2 task system (TaskCreate/TaskUpdate/TaskList/TaskGet) is active.
 * Defaults to true for interactive TUI sessions.
 * Set CLAUDE_CODE_ENABLE_TASKS=0 to force V1 (todo-write).
 */
export function isTodoV2Enabled(): boolean {
  if (process.env.CLAUDE_CODE_ENABLE_TASKS === '0') return false;
  if (process.env.CLAUDE_CODE_ENABLE_TASKS === '1') return true;
  return process.stdout.isTTY !== undefined;
}

// ---------------------------------------------------------------------------
// High water mark
// ---------------------------------------------------------------------------

async function readHighWaterMark(taskListId: string): Promise<number> {
  try {
    const content = (await readFile(getHighWaterMarkPath(taskListId), 'utf-8')).trim();
    const value = parseInt(content, 10);
    return isNaN(value) ? 0 : value;
  } catch {
    return 0;
  }
}

async function writeHighWaterMark(taskListId: string, value: number): Promise<void> {
  await writeFile(getHighWaterMarkPath(taskListId), String(value));
}

async function findHighestTaskId(taskListId: string): Promise<number> {
  const dir = getTaskListDir(taskListId);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return 0;
  }
  let highest = 0;
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const taskId = parseInt(file.replace('.json', ''), 10);
    if (!isNaN(taskId) && taskId > highest) highest = taskId;
  }
  const fromMark = await readHighWaterMark(taskListId);
  return Math.max(highest, fromMark);
}

// ---------------------------------------------------------------------------
// Ensure directory
// ---------------------------------------------------------------------------

async function ensureDir(taskListId: string): Promise<void> {
  const dir = getTaskListDir(taskListId);
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // Directory already exists
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createTask(
  input: CreateTaskInput,
  taskListId?: string,
): Promise<Task> {
  const listId = taskListId || getTaskListId();
  await ensureDir(listId);
  const lockPath = await ensureLockFile(getLockPath(listId));

  let release: (() => Promise<void>) | undefined;
  try {
    release = await lock(lockPath);

    const highestId = await findHighestTaskId(listId);
    const id = String(highestId + 1);
    const now = Date.now();

    const task: Task = {
      id,
      subject: input.subject,
      description: input.description,
      activeForm: input.activeForm,
      status: 'pending',
      owner: undefined,
      blocks: [],
      blockedBy: [],
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };

    const path = getTaskPath(listId, id);
    await writeFile(path, JSON.stringify(task, null, 2));
    return task;
  } finally {
    if (release) await release();
  }
}

export async function getTask(
  id: string,
  taskListId?: string,
): Promise<Task | null> {
  const listId = taskListId || getTaskListId();
  const path = getTaskPath(listId, id);
  try {
    const content = await readFile(path, 'utf-8');
    const data = JSON.parse(content);
    return validateTask(data);
  } catch {
    return null;
  }
}

export async function listTasks(taskListId?: string): Promise<Task[]> {
  const listId = taskListId || getTaskListId();
  const dir = getTaskListDir(listId);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const taskIds = files
    .filter(f => f.endsWith('.json') && !f.startsWith('.'))
    .map(f => f.replace('.json', ''));
  const results = await Promise.all(taskIds.map(id => getTask(id, listId)));
  return results.filter((t): t is Task => t !== null);
}

export async function updateTask(
  id: string,
  input: UpdateTaskInput,
  taskListId?: string,
): Promise<{ task: Task; updatedFields: string[] } | { error: string }> {
  const listId = taskListId || getTaskListId();
  const path = getTaskPath(listId, id);

  // Check existence before locking
  const existing = await getTask(id, listId);
  if (!existing) return { error: `Task #${id} not found` };

  let release: (() => Promise<void>) | undefined;
  try {
    release = await lock(path);

    // Re-read under lock
    const task = await getTask(id, listId);
    if (!task) return { error: `Task #${id} not found` };

    const updatedFields: string[] = [];

    // Handle deletion
    if (input.status === 'deleted') {
      // Update high water mark before deleting
      const numericId = parseInt(id, 10);
      if (!isNaN(numericId)) {
        const currentMark = await readHighWaterMark(listId);
        if (numericId > currentMark) {
          await writeHighWaterMark(listId, numericId);
        }
      }

      try {
        await unlink(path);
      } catch {
        return { error: `Failed to delete task #${id}` };
      }

      // Clean up dependency references from other tasks
      const allTasks = await listTasks(listId);
      for (const t of allTasks) {
        const newBlocks = t.blocks.filter(bid => bid !== id);
        const newBlockedBy = t.blockedBy.filter(bid => bid !== id);
        if (newBlocks.length !== t.blocks.length || newBlockedBy.length !== t.blockedBy.length) {
          await updateTaskUnsafe(listId, t.id, { blocks: newBlocks, blockedBy: newBlockedBy });
        }
      }

      task.status = 'deleted' as TaskStatus;
      return { task, updatedFields: ['status'] };
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
    if (input.addBlocks && input.addBlocks.length > 0) {
      const newBlocks = input.addBlocks.filter(bid => !task.blocks.includes(bid) && bid !== id);
      for (const blockedId of newBlocks) {
        await blockTask(listId, id, blockedId);
      }
      if (newBlocks.length > 0) updatedFields.push('blocks');
    }

    if (input.addBlockedBy && input.addBlockedBy.length > 0) {
      const newBlockedBy = input.addBlockedBy.filter(bid => !task.blockedBy.includes(bid) && bid !== id);
      for (const blockerId of newBlockedBy) {
        await blockTask(listId, blockerId, id);
      }
      if (newBlockedBy.length > 0) updatedFields.push('blockedBy');
    }

    task.updatedAt = Date.now();
    await writeFile(path, JSON.stringify(task, null, 2));
    return { task, updatedFields };
  } finally {
    if (release) await release();
  }
}

/**
 * Internal update without acquiring a lock.
 * Callers must already hold the lock on the task file.
 */
async function updateTaskUnsafe(
  taskListId: string,
  taskId: string,
  updates: { blocks?: string[]; blockedBy?: string[] },
): Promise<void> {
  const task = await getTask(taskId, taskListId);
  if (!task) return;
  if (updates.blocks) task.blocks = updates.blocks;
  if (updates.blockedBy) task.blockedBy = updates.blockedBy;
  task.updatedAt = Date.now();
  const path = getTaskPath(taskListId, taskId);
  await writeFile(path, JSON.stringify(task, null, 2));
}

// ---------------------------------------------------------------------------
// blockTask — atomic two-way dependency setup
// ---------------------------------------------------------------------------

/**
 * Set up a blocking relationship: fromTaskId blocks toTaskId.
 * Maintains both sides of the dependency (from.blocks and to.blockedBy).
 * Each task update acquires its own file lock.
 */
export async function blockTask(
  fromTaskId: string,
  toTaskId: string,
  taskListId?: string,
): Promise<boolean> {
  const listId = taskListId || getTaskListId();

  const [fromTask, toTask] = await Promise.all([
    getTask(fromTaskId, listId),
    getTask(toTaskId, listId),
  ]);
  if (!fromTask || !toTask) return false;

  if (!fromTask.blocks.includes(toTaskId)) {
    fromTask.blocks = [...fromTask.blocks, toTaskId];
    fromTask.updatedAt = Date.now();
    const fromPath = getTaskPath(listId, fromTaskId);
    let release: (() => Promise<void>) | undefined;
    try {
      release = await lock(fromPath);
      await writeFile(fromPath, JSON.stringify(fromTask, null, 2));
    } finally {
      if (release) await release();
    }
  }

  if (!toTask.blockedBy.includes(fromTaskId)) {
    toTask.blockedBy = [...toTask.blockedBy, fromTaskId];
    toTask.updatedAt = Date.now();
    const toPath = getTaskPath(listId, toTaskId);
    let release: (() => Promise<void>) | undefined;
    try {
      release = await lock(toPath);
      await writeFile(toPath, JSON.stringify(toTask, null, 2));
    } finally {
      if (release) await release();
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// claimTask — atomic claim with race protection
// ---------------------------------------------------------------------------

/**
 * Attempt to claim a task atomically.
 *
 * Default mode (task-level lock): locks only the target task file.
 * Use for single-agent scenarios.
 *
 * checkAgentBusy mode (list-level lock): locks the entire task list to
 * atomically check if the agent already owns unresolved tasks, preventing
 * TOCTOU races in multi-agent scenarios.
 */
export async function claimTask(
  taskId: string,
  claimantAgentId: string,
  options: ClaimTaskOptions = {},
  taskListId?: string,
): Promise<ClaimTaskResult> {
  const listId = taskListId || getTaskListId();
  const path = getTaskPath(listId, taskId);

  // Check existence before locking
  const preCheck = await getTask(taskId, listId);
  if (!preCheck) return { success: false, reason: 'task_not_found' };

  if (options.checkAgentBusy) {
    return claimTaskWithBusyCheck(listId, taskId, claimantAgentId);
  }

  // Task-level lock (default)
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lock(path);

    const task = await getTask(taskId, listId);
    if (!task) return { success: false, reason: 'task_not_found' };

    if (task.owner && task.owner !== claimantAgentId) {
      return { success: false, reason: 'already_claimed', task };
    }

    if (task.status === 'completed') {
      return { success: false, reason: 'already_resolved', task };
    }

    // Check unresolved blockers
    const allTasks = await listTasks(listId);
    const unresolvedIds = new Set(
      allTasks.filter(t => t.status !== 'completed').map(t => t.id),
    );
    const blockedBy = task.blockedBy.filter(bid => unresolvedIds.has(bid));
    if (blockedBy.length > 0) {
      return { success: false, reason: 'blocked', task, blockedByTasks: blockedBy };
    }

    // Claim it
    task.owner = claimantAgentId;
    task.updatedAt = Date.now();
    await writeFile(path, JSON.stringify(task, null, 2));
    return { success: true, task };
  } finally {
    if (release) await release();
  }
}

async function claimTaskWithBusyCheck(
  taskListId: string,
  taskId: string,
  claimantAgentId: string,
): Promise<ClaimTaskResult> {
  const lockPath = getLockPath(taskListId);
  await ensureLockFile(lockPath);

  let release: (() => Promise<void>) | undefined;
  try {
    release = await lock(lockPath);

    const allTasks = await listTasks(taskListId);
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return { success: false, reason: 'task_not_found' };

    if (task.owner && task.owner !== claimantAgentId) {
      return { success: false, reason: 'already_claimed', task };
    }

    if (task.status === 'completed') {
      return { success: false, reason: 'already_resolved', task };
    }

    const unresolvedIds = new Set(
      allTasks.filter(t => t.status !== 'completed').map(t => t.id),
    );
    const blockedBy = task.blockedBy.filter(bid => unresolvedIds.has(bid));
    if (blockedBy.length > 0) {
      return { success: false, reason: 'blocked', task, blockedByTasks: blockedBy };
    }

    // Agent busy check
    const agentOpenTasks = allTasks.filter(
      t =>
        t.status !== 'completed' &&
        t.owner === claimantAgentId &&
        t.id !== taskId,
    );
    if (agentOpenTasks.length > 0) {
      return {
        success: false,
        reason: 'agent_busy',
        task,
        busyWithTasks: agentOpenTasks.map(t => t.id),
      };
    }

    // Claim it
    task.owner = claimantAgentId;
    task.updatedAt = Date.now();
    const path = getTaskPath(taskListId, taskId);
    await writeFile(path, JSON.stringify(task, null, 2));
    return { success: true, task };
  } finally {
    if (release) await release();
  }
}

// ---------------------------------------------------------------------------
// unassignTeammateTasks — reclaim tasks when an agent exits
// ---------------------------------------------------------------------------

export interface UnassignResult {
  unassignedTasks: Array<{ id: string; subject: string }>;
}

/**
 * Reset all open tasks owned by an agent back to pending.
 * Call when a sub-agent is stopped, terminated, or shuts down.
 */
export async function unassignTeammateTasks(
  ownerName: string,
  taskListId?: string,
): Promise<UnassignResult> {
  const listId = taskListId || getTaskListId();
  const allTasks = await listTasks(listId);
  const agentTasks = allTasks.filter(
    t => t.status !== 'completed' && t.owner === ownerName,
  );

  for (const task of agentTasks) {
    const path = getTaskPath(listId, task.id);
    let release: (() => Promise<void>) | undefined;
    try {
      release = await lock(path);
      const current = await getTask(task.id, listId);
      if (current && current.owner === ownerName && current.status !== 'completed') {
        current.owner = undefined;
        current.status = 'pending';
        current.updatedAt = Date.now();
        await writeFile(path, JSON.stringify(current, null, 2));
      }
    } finally {
      if (release) await release();
    }
  }

  return {
    unassignedTasks: agentTasks.map(t => ({ id: t.id, subject: t.subject })),
  };
}

export async function getAgentStatuses(
  taskListId?: string,
): Promise<import('./schema.js').AgentStatus[]> {
  const listId = taskListId || getTaskListId();
  const allTasks = await listTasks(listId);

  // Group unresolved tasks by owner
  const byOwner = new Map<string, string[]>();
  for (const task of allTasks) {
    if (task.status !== 'completed' && task.owner) {
      const existing = byOwner.get(task.owner) ?? [];
      existing.push(task.id);
      byOwner.set(task.owner, existing);
    }
  }

  // Collect unique agents from active tasks + owned completed tasks
  const agents = new Set<string>();
  for (const task of allTasks) {
    if (task.owner) agents.add(task.owner);
  }

  return Array.from(agents).map(agentId => ({
    agentId,
    name: agentId,
    status: (byOwner.get(agentId)?.length ?? 0) > 0 ? 'busy' as const : 'idle' as const,
    currentTasks: byOwner.get(agentId) ?? [],
  }));
}
export async function resetStore(taskListId?: string): Promise<void> {
  const listId = taskListId || getTaskListId();
  const dir = getTaskListDir(listId);
  const lockPath = await ensureLockFile(getLockPath(listId));

  let release: (() => Promise<void>) | undefined;
  try {
    release = await lock(lockPath);

    const currentHighest = await findHighestTaskId(listId);
    if (currentHighest > 0) {
      await writeHighWaterMark(listId, currentHighest);
    }

    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return;
    }
    for (const file of files) {
      if (file.endsWith('.json') && !file.startsWith('.')) {
        try {
          await unlink(join(dir, file));
        } catch {
          // File may already be deleted
        }
      }
    }
  } finally {
    if (release) await release();
  }
}
