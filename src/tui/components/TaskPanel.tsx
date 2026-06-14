import { useEffect, useState, useRef } from 'react';
import { Box, Text } from 'ink';
import { listTasks } from '../../tasks/store.js';
import type { Task } from '../../tasks/schema.js';

interface TaskPanelProps {
  dismissed: boolean;
  onDismissReset?: () => void;
}

const POLL_INTERVAL_MS = 1000;
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 80;

const STATUS_ICON: Record<string, string> = {
  pending: '○',
  in_progress: '⟳',
  completed: '✓',
};

const STATUS_COLOR: Record<string, string> = {
  pending: undefined as unknown as string,
  in_progress: 'yellow',
  completed: 'green',
};

/**
 * Fixed task panel pinned above the input box.
 *
 * Batch behaviour: completed tasks stay visible alongside their batch-mates
 * as long as any task in the batch remains active.  Once every task is done
 * the whole batch disappears and won't reappear when new tasks are created.
 */
export function TaskPanel({ dismissed, onDismissReset }: TaskPanelProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const prevActiveCount = useRef(0);
  const hiddenIds = useRef<Set<string>>(new Set());
  const prevFingerprint = useRef('');

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const current = await listTasks();
        if (!active) return;

        const fp = current.map(t => `${t.id}:${t.status}:${t.owner ?? ''}:${t.subject}:${t.activeForm ?? ''}:${t.blocks.join(',')}:${t.blockedBy.join(',')}`).join('|');
        if (fp !== prevFingerprint.current) {
          prevFingerprint.current = fp;
          setTasks(current);
        }

        const activeCount = current.filter(t => t.status !== 'completed').length;

        // Batch just finished — hide all completed tasks from this batch
        if (activeCount === 0 && prevActiveCount.current > 0) {
          for (const t of current) {
            if (t.status === 'completed') hiddenIds.current.add(t.id);
          }
        }

        // New tasks arrived — reset dismiss, clear hidden set
        if (activeCount > prevActiveCount.current && activeCount > 0) {
          if (dismissed) onDismissReset?.();
          // New batch starting — forget old completed tasks
          if (prevActiveCount.current === 0) {
            hiddenIds.current = new Set();
          }
        }

        prevActiveCount.current = activeCount;
      } catch {
        // Silently ignore poll errors
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [dismissed, onDismissReset]);

  // Animated spinner for in_progress tasks
  const [spinnerIndex, setSpinnerIndex] = useState(0);
  useEffect(() => {
    const hasInProgress = tasks.some(t => t.status === 'in_progress');
    if (dismissed || !hasInProgress) return;
    const id = setInterval(() => {
      setSpinnerIndex(i => (i + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL_MS);
    return () => clearInterval(id);
  }, [tasks, dismissed]);

  if (dismissed) return null;

  // Filter: show active tasks + completed tasks from the current batch
  const visible = tasks.filter(t =>
    t.status !== 'completed' || !hiddenIds.current.has(t.id),
  );
  if (visible.length === 0) return null;

  const hasActive = visible.some(t => t.status !== 'completed');

  // Sort: in_progress → pending → completed
  const sorted = [...visible].sort((a, b) => {
    const order: Record<string, number> = { in_progress: 0, pending: 1, completed: 2 };
    return (order[a.status] ?? 1) - (order[b.status] ?? 1);
  });

  const display = sorted.slice(0, 8);
  const truncated = sorted.length - display.length;

  const pendingCount = visible.filter(t => t.status === 'pending').length;
  const activeCount = visible.filter(t => t.status === 'in_progress').length;
  const doneCount = visible.filter(t => t.status === 'completed').length;

  // Only ONE in_progress task shows ⟳ — the one with an owner, or the most recently updated
  let realActiveId: string | null = null;
  const inProgress = visible.filter(t => t.status === 'in_progress');
  if (inProgress.length > 0) {
    const owned = inProgress.filter(t => t.owner);
    const candidate = owned.length > 0 ? owned : inProgress;
    realActiveId = candidate.reduce((a, b) => a.updatedAt > b.updatedAt ? a : b).id;
  }

  return (
    <Box flexDirection="column" flexShrink={0} alignSelf="flex-start" paddingX={1} borderStyle="single" borderColor="grey">
      <Box>
        <Text bold>Tasks </Text>
        <Text dimColor>
          ({pendingCount} pending, {activeCount} active
          {doneCount > 0 ? `, ${doneCount} done` : ''})
        </Text>
        {hasActive && <Text dimColor> — Ctrl+P to dismiss</Text>}
      </Box>

      {display.map((task) => {
        const isActive = task.id === realActiveId;
        const icon = isActive ? SPINNER_FRAMES[spinnerIndex] : (STATUS_ICON[task.status] ?? '?');
        const color = isActive ? 'yellow' : STATUS_COLOR[task.status];

        const ownerTag = task.owner ? ` [${task.owner}]` : '';
        const blockedByTag = task.blockedBy.length > 0
          ? ` (blocked by: ${task.blockedBy.map(id => `#${id}`).join(',')})`
          : '';
        const blocksTag = task.blocks.length > 0
          ? ` (blocks: ${task.blocks.map(id => `#${id}`).join(',')})`
          : '';
        const deps = blockedByTag || blocksTag;

        const label = task.status === 'in_progress' && task.activeForm
          ? task.activeForm
          : task.subject;

        return (
          <Box key={task.id} flexShrink={0}>
            <Text color={color}>{icon} </Text>
            <Text dimColor>#{task.id} </Text>
            <Text dimColor={task.status === 'completed'}>{label}</Text>
            <Text dimColor>{ownerTag}{deps}</Text>
          </Box>
        );
      })}

      {truncated > 0 && (
        <Box>
          <Text dimColor>  ... and {truncated} more</Text>
        </Box>
      )}
    </Box>
  );
}
