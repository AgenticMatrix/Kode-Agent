import { useEffect, useState, useRef } from 'react';
import { Box, Text } from 'ink';
import { listTasks } from '../../tasks/store.js';
import type { Task } from '../../tasks/schema.js';

interface TaskPanelProps {
  /** When true, the panel was manually dismissed by the user. */
  dismissed: boolean;
  /** Called when the dismiss state should be reset (new tasks arrived). */
  onDismissReset?: () => void;
}

const POLL_INTERVAL_MS = 1000;
const HIDE_DELAY_MS = 3000;

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
 * Fixed task panel that polls listTasks() and renders a compact task list.
 * Auto-shows when tasks exist, auto-hides 3s after all tasks complete.
 * Ctrl+P dismisses it; new tasks reset the dismiss.
 */
export function TaskPanel({ dismissed, onDismissReset }: TaskPanelProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevCount = useRef(0);

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const current = await listTasks();
        if (!active) return;
        setTasks(current);

        const count = current.length;

        // New tasks arrived — reset dismiss
        if (count > prevCount.current && count > 0 && dismissed) {
          onDismissReset?.();
        }
        prevCount.current = count;

        if (count > 0) {
          if (hideTimer.current) {
            clearTimeout(hideTimer.current);
            hideTimer.current = null;
          }
          setVisible(true);
        } else {
          // Delay hide when all tasks disappear
          if (!hideTimer.current) {
            hideTimer.current = setTimeout(() => {
              if (active) setVisible(false);
              hideTimer.current = null;
            }, HIDE_DELAY_MS);
          }
        }
      } catch {
        // Silently ignore poll errors
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [dismissed, onDismissReset]);

  if (dismissed || (!visible && tasks.length === 0)) return null;

  // Sort: in_progress first, then pending, then completed at bottom
  const sorted = [...tasks].sort((a, b) => {
    const order = { in_progress: 0, pending: 1, completed: 2 };
    return (order[a.status] ?? 1) - (order[b.status] ?? 1);
  });

  // Limit to 8 tasks to keep the panel compact
  const display = sorted.slice(0, 8);
  const truncated = sorted.length - display.length;

  const summary = [
    tasks.filter(t => t.status === 'pending').length,
    tasks.filter(t => t.status === 'in_progress').length,
    tasks.filter(t => t.status === 'completed').length,
  ];

  return (
    <Box flexDirection="column" flexShrink={0} paddingX={1} borderStyle="single" borderColor="grey">
      <Box>
        <Text bold>Tasks </Text>
        <Text dimColor>
          ({summary[0]} pending, {summary[1]} active, {summary[2]} done)
        </Text>
        <Text dimColor> — Ctrl+P to dismiss</Text>
      </Box>

      {display.map((task) => {
        const icon = STATUS_ICON[task.status] ?? '?';
        const color = STATUS_COLOR[task.status];

        const ownerTag = task.owner ? ` [${task.owner}]` : '';
        const blockedByTag = task.blockedBy.length > 0
          ? ` (blocked by: ${task.blockedBy.map(id => `#${id}`).join(',')})`
          : '';
        const blocksTag = task.blocks.length > 0
          ? ` (blocks: ${task.blocks.map(id => `#${id}`).join(',')})`
          : '';
        const deps = blockedByTag || blocksTag;

        // Show activeForm instead of subject when in_progress
        const label = task.status === 'in_progress' && task.activeForm
          ? task.activeForm
          : task.subject;

        return (
          <Box key={task.id} flexShrink={0}>
            <Text color={color}>{icon} </Text>
            <Text dimColor>#{task.id} </Text>
            <Text>{label}</Text>
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
