import { useRef } from 'react';
import { Box, Text, Static } from 'ink';

import type { QueryEngine } from '../../core/query-engine.js';
import type { AppConfig, Message } from '../../types.js';
import { HeaderLogo } from './HeaderLogo.js';
import { MessageBubble } from './MessageBubble.js';
import { InputBox } from './InputBox.js';
import { StatusBar } from './StatusBar.js';
import { useChatReducer } from '../hooks/useChatReducer.js';
import { useAgentBridge } from '../hooks/useAgentBridge.js';
import { useInputHandler } from '../hooks/useInputHandler.js';
import { useTokenStats } from '../hooks/useTokenStats.js';
import { createSlashHandler } from '../../commands/index.js';

interface AppProps {
  config: AppConfig;
  engine: QueryEngine;
}

/** True when a user message contains only tool_result blocks. */
function isToolResultOnly(m: Message): boolean {
  return m.role === 'user' && m.blocks.length > 0 && m.blocks.every((b) => b.type === 'tool_result');
}

/** Find the index where the live (current-turn) zone begins. */
function getLiveStart(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && !isToolResultOnly(messages[i])) {
      return i;
    }
  }
  return 0;
}

type StaticItem = { _type: 'header' } | { _type: 'message'; msg: Message };

/**
 * App shell with zone-separated rendering:
 *
 *  Static zone  (<Static>)       — HeaderLogo + past turns, never re-rendered
 *  Live zone                     — current turn + input + StatusBar
 *
 * StatusBar ticks every 1 s but only the live zone is rewritten,
 * preserving terminal text selection on historical content.
 */
export function App({ config, engine }: AppProps) {
  const [state, dispatch] = useChatReducer(config.model);

  const messagesRef = useRef(state.messages);
  messagesRef.current = state.messages;

  const { runAgentTurn } = useAgentBridge({ engine, dispatch });

  useInputHandler({
    inputText: state.inputText,
    cursorPosition: state.cursorPosition,
    isStreaming: state.isStreaming,
    messages: state.messages,
    dispatch,
    onSend: runAgentTurn,
    onSlashCommand: createSlashHandler({
      dispatch,
      send: runAgentTurn,
      model: config.model,
      isStreaming: state.isStreaming,
      inputText: state.inputText,
      onExit: () => {
        process.exit(0);
      },
    }),
  });

  const stats = useTokenStats(state.messages);

  const messages = state.messages;
  const liveStart = getLiveStart(messages);
  const historical = messages.slice(0, liveStart);
  const live = messages.slice(liveStart);

  const staticItems: StaticItem[] = [
    { _type: 'header' },
    ...historical.map((msg): StaticItem => ({ _type: 'message', msg })),
  ];

  return (
    <Box flexDirection="column" height="100%" padding={1}>
      {/* ── Static zone: never re-rendered ─────────────────────── */}
      <Static items={staticItems}>
        {(item) => {
          if (item._type === 'header') return <HeaderLogo key="header" />;
          return <MessageBubble key={item.msg.id} message={item.msg} />;
        }}
      </Static>

      {/* ── Live zone: current turn + input ────────────────────── */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {messages.length === 0 && !state.isStreaming && (
          <Box marginY={1}>
            <Text dimColor>
              Welcome to Ink Chat TUI! Type a message and press Enter to start.
            </Text>
          </Box>
        )}

        {live.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {state.isStreaming && (
          <Box marginTop={1}>
            <Text color="yellow" dimColor>● Generating...</Text>
          </Box>
        )}
      </Box>

      <InputBox
        inputText={state.inputText}
        cursorPosition={state.cursorPosition}
        isStreaming={state.isStreaming}
      />

      <Box marginTop={1}>
        <StatusBar
          model={state.model}
          isStreaming={state.isStreaming}
          error={state.error}
          totalChars={stats.totalChars}
          inputTokens={stats.inputTokens}
          outputTokens={stats.outputTokens}
        />
      </Box>
    </Box>
  );
}
