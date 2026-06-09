import { Box, Text } from 'ink';

import type { Message } from '../../types.js';
import { MessageBubble } from './MessageBubble.js';

interface ChatViewProps {
  messages: Message[];
  isStreaming: boolean;
}

/**
 * Renders the scrollable chat message list.
 * Shows a streaming indicator when the assistant is generating.
 */
export function ChatView({ messages, isStreaming }: ChatViewProps) {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {messages.length === 0 && !isStreaming && (
        <Box marginY={1}>
          <Text dimColor>
            Welcome to Ink Chat TUI! Type a message and press Enter to start.
          </Text>
        </Box>
      )}

      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}

      {isStreaming && (
        <Box marginTop={1}>
          <Text color="yellow" dimColor>
            ● Generating...
          </Text>
        </Box>
      )}
    </Box>
  );
}
