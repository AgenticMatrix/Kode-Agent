export const TASK_STATUSES = ['pending', 'in_progress', 'completed'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

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
  status?: TaskStatus | 'deleted';
  owner?: string;
  addBlocks?: string[];
  addBlockedBy?: string[];
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Claim
// ---------------------------------------------------------------------------

export type ClaimFailureReason =
  | 'task_not_found'
  | 'already_claimed'
  | 'already_resolved'
  | 'blocked'
  | 'agent_busy';

export interface ClaimTaskResult {
  success: boolean;
  reason?: ClaimFailureReason;
  task?: Task;
  busyWithTasks?: string[];
  blockedByTasks?: string[];
}

export interface ClaimTaskOptions {
  /**
   * If true, atomically checks whether the agent already owns unresolved tasks
   * before allowing the claim. Uses a task-list-level lock.
   */
  checkAgentBusy?: boolean;
}

// ---------------------------------------------------------------------------
// Agent status
// ---------------------------------------------------------------------------

export interface AgentStatus {
  agentId: string;
  name: string;
  status: 'idle' | 'busy';
  currentTasks: string[];
}

/** Validate and coerce a raw JSON object into a Task. Returns null if invalid. */
export function validateTask(data: unknown): Task | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;

  if (typeof obj.id !== 'string') return null;
  if (typeof obj.subject !== 'string') return null;
  if (typeof obj.description !== 'string') return null;
  if (!TASK_STATUSES.includes(obj.status as TaskStatus)) return null;
  if (!Array.isArray(obj.blocks)) return null;
  if (!Array.isArray(obj.blockedBy)) return null;
  if (typeof obj.createdAt !== 'number') return null;
  if (typeof obj.updatedAt !== 'number') return null;

  return {
    id: obj.id,
    subject: obj.subject,
    description: obj.description,
    activeForm: typeof obj.activeForm === 'string' ? obj.activeForm : undefined,
    owner: typeof obj.owner === 'string' ? obj.owner : undefined,
    status: obj.status as TaskStatus,
    blocks: obj.blocks.filter((b): b is string => typeof b === 'string'),
    blockedBy: obj.blockedBy.filter((b): b is string => typeof b === 'string'),
    metadata: typeof obj.metadata === 'object' && obj.metadata !== null
      ? obj.metadata as Record<string, unknown>
      : {},
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}
