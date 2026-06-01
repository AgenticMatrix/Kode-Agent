/**
 * TaskListTool — List and query trackable tasks
 *
 * Reads all task JSON files from the session's tasks directory.
 * Supports filtering by status, parentTaskId, and topological
 * sorting by the dependency graph.
 *
 * Risk: SAFE — read-only, no filesystem mutations.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  BaseTool,
  RiskLevel,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
} from '@kode/shared';
import { type TaskRecord, getTasksDir } from './task-create.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export interface TaskListInput {
  status?: TaskStatus | TaskStatus[];
  parentTaskId?: string;
}

export interface TaskListItem {
  taskId: string;
  name: string;
  description: string;
  status: TaskStatus;
  dependencies: string[];
  parentTaskId?: string;
  agentId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface TaskListOutput {
  tasks: TaskListItem[];
  totalCount: number;
  statusCounts: Record<TaskStatus, number>;
}

// ---------------------------------------------------------------------------
// TaskListTool
// ---------------------------------------------------------------------------

const TASK_LIST_DESCRIPTION = `List and query trackable background tasks.

Returns tasks sorted by their dependency graph (topological order).
Filter by 'status' to see only tasks in a specific state, or pass
an array of statuses. Use 'parentTaskId' to find child tasks.

Task statuses: pending, in_progress, completed, failed, cancelled`;

export class TaskListTool extends BaseTool<TaskListInput, TaskListOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'TaskList',
      description: TASK_LIST_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          status: {
            oneOf: [
              {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'failed', 'cancelled'],
              },
              {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed', 'failed', 'cancelled'],
                },
              },
            ],
            description: 'Filter by task status (single value or array)',
          },
          parentTaskId: {
            type: 'string',
            description: 'Filter by parent task ID (tasks assigned as children)',
          },
        },
        required: [],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.SAFE,
    };
  }

  override validate(input: unknown): ValidationResult {
    if (input === null || input === undefined || typeof input !== 'object') {
      return { valid: true }; // Empty input is fine — list all
    }
    const typed = input as Record<string, unknown>;

    if (typed.status !== undefined) {
      const validStatuses: TaskStatus[] = [
        'pending',
        'in_progress',
        'completed',
        'failed',
        'cancelled',
      ];
      if (Array.isArray(typed.status)) {
        for (let i = 0; i < typed.status.length; i++) {
          if (!validStatuses.includes(typed.status[i] as TaskStatus)) {
            return {
              valid: false,
              errors: [
                {
                  path: `status[${i}]`,
                  message: `status must be one of: ${validStatuses.join(', ')}`,
                },
              ],
            };
          }
        }
      } else if (typeof typed.status === 'string') {
        if (!validStatuses.includes(typed.status as TaskStatus)) {
          return {
            valid: false,
            errors: [
              {
                path: 'status',
                message: `status must be one of: ${validStatuses.join(', ')}`,
              },
            ],
          };
        }
      } else {
        return {
          valid: false,
          errors: [{ path: 'status', message: 'status must be a string or array' }],
        };
      }
    }

    if (typed.parentTaskId !== undefined && typeof typed.parentTaskId !== 'string') {
      return {
        valid: false,
        errors: [{ path: 'parentTaskId', message: 'parentTaskId must be a string' }],
      };
    }

    return { valid: true };
  }

  override async execute(input: TaskListInput, ctx: ToolContext): Promise<TaskListOutput> {
    const tasksDir = getTasksDir(ctx.sessionId);

    // Read all task records
    const records: TaskRecord[] = [];

    if (existsSync(tasksDir)) {
      const files = readdirSync(tasksDir).filter((f) => f.endsWith('.json'));

      for (const file of files) {
        try {
          const raw = readFileSync(join(tasksDir, file), 'utf-8');
          const record: TaskRecord = JSON.parse(raw);
          records.push(record);
        } catch {
          // Skip malformed task files
        }
      }
    }

    // Apply status filter
    let filtered = records;
    if (input.status !== undefined) {
      const statuses = Array.isArray(input.status) ? input.status : [input.status];
      filtered = filtered.filter((r) => statuses.includes(r.status));
    }

    // Apply parentTaskId filter (optional field, may not exist on all records)
    if (input.parentTaskId) {
      filtered = filtered.filter(
        (r) => (r as TaskRecord & { parentTaskId?: string }).parentTaskId === input.parentTaskId,
      );
    }

    // Topological sort by dependencies (Kahn's algorithm)
    const sorted = topologicalSort(filtered);

    // Build status counts from the full set (unfiltered)
    const statusCounts: Record<TaskStatus, number> = {
      pending: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const r of records) {
      statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
    }

    const tasks: TaskListItem[] = sorted.map((r) => ({
      taskId: r.taskId,
      name: r.name,
      description: r.description,
      status: r.status,
      dependencies: r.dependencies,
      parentTaskId: (r as TaskRecord & { parentTaskId?: string }).parentTaskId,
      agentId: r.agentId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      completedAt: r.completedAt,
    }));

    return {
      tasks,
      totalCount: tasks.length,
      statusCounts,
    };
  }

  override formatOutput(result: TaskListOutput): string {
    if (result.tasks.length === 0) {
      return 'No tasks found.';
    }

    const lines: string[] = [`Tasks: ${result.totalCount} total`];
    const statusSummary = Object.entries(result.statusCounts)
      .filter(([, count]) => count > 0)
      .map(([status, count]) => `${status}: ${count}`)
      .join(', ');
    lines.push(`Status summary: ${statusSummary}`);
    lines.push('');

    for (const task of result.tasks) {
      const icon =
        task.status === 'completed'
          ? '✅'
          : task.status === 'in_progress'
            ? '🔄'
            : task.status === 'failed'
              ? '❌'
              : task.status === 'cancelled'
                ? '🚫'
                : '⬜';
      const deps = task.dependencies.length > 0 ? ` (deps: ${task.dependencies.join(', ')})` : '';
      lines.push(`${icon} [${task.taskId.slice(0, 8)}] ${task.name} — ${task.status}${deps}`);
    }

    return lines.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Topological sort helper (Kahn's algorithm)
// ---------------------------------------------------------------------------

function topologicalSort(records: TaskRecord[]): TaskRecord[] {
  if (records.length <= 1) return records;

  const taskIds = new Set(records.map((r) => r.taskId));
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  // Initialize
  for (const r of records) {
    inDegree.set(r.taskId, 0);
    adjList.set(r.taskId, []);
  }

  // Build graph (only consider dependencies that exist in this set)
  for (const r of records) {
    for (const dep of r.dependencies) {
      if (taskIds.has(dep)) {
        adjList.get(dep)!.push(r.taskId);
        inDegree.set(r.taskId, (inDegree.get(r.taskId) ?? 0) + 1);
      }
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: TaskRecord[] = [];
  const recordMap = new Map(records.map((r) => [r.taskId, r]));

  while (queue.length > 0) {
    const id = queue.shift()!;
    const record = recordMap.get(id);
    if (record) sorted.push(record);

    for (const neighbor of adjList.get(id) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  // Append any remaining tasks (circular dependency / external deps)
  for (const id of queue) {
    const record = recordMap.get(id);
    if (record) sorted.push(record);
  }

  // Add tasks that weren't reachable (shouldn't happen with Kahn's, but safeguard)
  for (const r of records) {
    if (!sorted.find((s) => s.taskId === r.taskId)) {
      sorted.push(r);
    }
  }

  return sorted;
}
