import { Box, Text } from 'ink';
import type { TodoItem } from '../../../types.js';

export interface TodoUpdateBlockRendererProps {
  todos: TodoItem[];
  oldTodos?: TodoItem[];
}

const STATUS_ICON: Record<string, string> = {
  completed: '🟢',
  in_progress: '⏳',
  pending: '⬜',
};

const STATUS_LABEL: Record<string, string> = {
  completed: 'done',
  in_progress: 'in progress',
  pending: 'todo',
};

/**
 * Renders a todo_update block as a task board.
 *
 * ┌─ 📋 Tasks ─────────────────────────────────────────┐
 * │  🟢 1. Add cursorPosition to types    ← completed  │
 * │  ⏳ 2. Update chatReducer             ← in_progress│
 * │  ⬜ 3. Test the implementation                      │
 * └─────────────────────────────────────────────────────┘
 */
export function TodoUpdateBlockRenderer({ todos, oldTodos }: TodoUpdateBlockRendererProps) {
  if (!todos || todos.length === 0) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      paddingX={1}
      marginBottom={1}
    >
      <Box marginBottom={0}>
        <Text bold color="cyan">
          📋 Tasks
        </Text>
        {oldTodos ? (
          <Text dimColor> (updated)</Text>
        ) : null}
      </Box>
      {todos.map((todo, i) => {
        const icon = STATUS_ICON[todo.status] ?? '⬜';
        const label = STATUS_LABEL[todo.status] ?? '';
        return (
          <Box key={i} flexDirection="row" paddingLeft={1}>
            <Text>
              <Text>{icon} </Text>
              <Text color="white">{i + 1}. {todo.content}</Text>
              {todo.status && todo.status !== 'pending' ? (
                <Text dimColor color="grey"> ← {label}</Text>
              ) : null}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
