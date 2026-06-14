import { useEffect, useRef, useMemo, useCallback } from 'react';
import { Box, Text, Static } from 'ink';

import type { QueryEngine } from '../../core/query-engine.js';
import type { AppConfig, Message } from '../../types.js';
import { PermissionMode } from '../../core/types.js';
import { HeaderLogo } from './HeaderLogo.js';
import { MessageBubble } from './MessageBubble.js';
import { InputBox } from './InputBox.js';
import { StatusBar } from './StatusBar.js';
import { ApprovalPrompt } from './ApprovalPrompt.js';
import { SubAgentTranscriptView } from './SubAgentTranscriptView.js';
import { SubAgentPicker } from './SubAgentPicker.js';
import { TaskPanel } from './TaskPanel.js';
import { TeamPanel } from './TeamPanel.js';
import { TeamAgentPicker } from './TeamAgentPicker.js';
import { OffscreenFreeze } from './OffscreenFreeze.js';
import { CommandHint } from './CommandHint.js';
import { useChatReducer } from '../hooks/useChatReducer.js';
import { useAgentBridge } from '../hooks/useAgentBridge.js';
import { useInputHandler } from '../hooks/useInputHandler.js';
import { useTokenStats } from '../hooks/useTokenStats.js';
import { createSlashHandler } from '../../commands/index.js';
import { getPendingApproval } from '../hooks/approval-store.js';
import { loadHistory, addToHistory } from '../../cli/history.js';

interface AppProps {
  config: AppConfig;
  engine: QueryEngine;
}

/** True when a user message contains only tool_result blocks. */
function isToolResultOnly(m: Message): boolean {
  return m.role === 'user' && m.blocks.length > 0 && m.blocks.every((b) => b.type === 'tool_result');
}

/** Find the index where the live (current-turn) zone begins.
 *
 *  During streaming we keep only the last 2 messages live (the currently-
 *  streaming assistant + the preceding tool_result).  Everything else is
 *  promoted to <Static>, minimizing the Ink output area that rewrites on
 *  every text delta. */
function getLiveStart(messages: Message[], isStreaming: boolean): number {
  if (isStreaming) {
    return Math.max(0, messages.length - 2);
  }
  // Not streaming: use turn boundary (last non-tool-result user message)
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
  const [state, dispatch] = useChatReducer(config.model, config.inputPrice, config.outputPrice, config.cacheReadPrice);

  const messagesRef = useRef(state.messages);
  messagesRef.current = state.messages;

  const { runAgentTurn } = useAgentBridge({ engine, dispatch });

  const handleTaskDismissReset = useCallback(() => dispatch({ type: 'TOGGLE_TASK_PANEL' }), [dispatch]);
  const handleTeamDismissReset = useCallback(() => dispatch({ type: 'TOGGLE_TEAM_PANEL' }), [dispatch]);

  // Load history on mount
  useEffect(() => {
    dispatch({ type: 'LOAD_HISTORY', history: loadHistory() });
  }, [dispatch]);

  // Persist new history entries to disk
  const prevHistoryLen = useRef(state.history.length);
  useEffect(() => {
    if (state.history.length > prevHistoryLen.current) {
      const last = state.history[state.history.length - 1];
      if (last) addToHistory(last, state.history.slice(0, -1));
    }
    prevHistoryLen.current = state.history.length;
  }, [state.history.length]);

  useInputHandler({
    inputText: state.inputText,
    cursorPosition: state.cursorPosition,
    isStreaming: state.isStreaming,
    messages: state.messages,
    dispatch,
    onSend: runAgentTurn,
    onInterrupt: () => engine.interrupt(),
    onExit: () => process.exit(0),
    blocked: state.approvalReq !== null || state.agentPicker,
    teamPicker: state.teamPicker,
    subAgentView: state.subAgentView,
    lastAgentViewId: state.lastAgentViewId,
    commandPickerIndex: state.commandPickerIndex,
    history: state.history,
    historyIndex: state.historyIndex,
    historyScratch: state.historyScratch,
    pasteBlocks: state.pasteBlocks,
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

  const handleApprovalChoice = (choice: string) => {
    const pending = getPendingApproval();
    if (!pending) return;

    if (choice === 'deny') {
      pending.deferred.resolve(false);
      engine.interrupt();
      dispatch({ type: 'INTERRUPT' });
    } else {
      // 'once', 'session', 'always' all approve the tool
      pending.deferred.resolve(true);
      // For session / always: switch to AUTO mode so subsequent
      // tool calls in this session don't prompt again.
      if (choice === 'session' || choice === 'always') {
        engine.setPermissionMode(PermissionMode.AUTO);
        dispatch({ type: 'SET_MODE', mode: 'auto' });
      }
    }
  };

  const stats = useTokenStats(state.messages, state.tokenUsage, state.accumulatedCost);

  const messages = state.messages;

  // When display is frozen (user scrolled up), keep showing the snapshot.
  // The reducer continues updating state.messages in the background.
  const frozenRef = useRef(state.messages);
  if (!state.isFrozen) frozenRef.current = state.messages;
  const displayMessages = state.isFrozen ? frozenRef.current : state.messages;

  // During streaming, liveStart advances as new messages arrive, promoting
  // completed messages to <Static>.  This keeps the live zone to ≤2 messages
  // so Ink only rewrites a minimal area on each text delta.
  const liveStart = getLiveStart(displayMessages, state.isStreaming);

  const staticItems = useMemo<StaticItem[]>(() => {
    const historical = displayMessages.slice(0, liveStart);
    return [
      { _type: 'header' as const },
      ...historical.map((msg): StaticItem => ({ _type: 'message' as const, msg })),
    ];
  }, [liveStart, state.contentExpanded]);

  const live = displayMessages.slice(liveStart);

  // Count new messages arrived while frozen
  const frozenNewCount = state.isFrozen && state.isStreaming
    ? state.messages.length - frozenRef.current.length
    : 0;

  return (
    <Box flexDirection="column" height="100%" padding={1}>
      {/* ── Static zone: never re-rendered ─────────────────────── */}
      <Static items={staticItems}>
        {(item) => {
          if (item._type === 'header') return <HeaderLogo key="header" />;
          return <MessageBubble key={item.msg.id} message={item.msg} contentExpanded={state.contentExpanded} />;
        }}
      </Static>

      {/* ── Freeze indicator (pre-allocated to avoid layout shift) ── */}
      {state.isFrozen && (
        <Box flexShrink={0} height={1}>
          <Text color="yellow" dimColor>
            ⏸ Paused — {frozenNewCount > 0 ? `${frozenNewCount} new message(s) — ` : ''}PageDown / End to follow
          </Text>
        </Box>
      )}
      {!state.isFrozen && <Box flexShrink={0} height={0} />}

      {/* ── Live zone: current turn + input ────────────────────── */}
      <Box flexDirection="column" flexGrow={1} flexShrink={1} paddingX={1}>
        {state.subAgentView ? (
          <SubAgentTranscriptView
            agentId={state.subAgentView.agentId}
            onBack={() => dispatch({ type: 'CLOSE_SUBAGENT_VIEW' })}
            onSendMessage={(agentId, message) => {
              engine.sendSubAgentMessage(agentId, message).then(() => {
                dispatch({ type: 'CLOSE_SUBAGENT_VIEW' });
              });
            }}
          />
        ) : (
          <>
            {displayMessages.length === 0 && !state.isStreaming && (
              <Box marginY={1}>
                <Text dimColor>
                  Welcome to Coder Chat TUI! Type a message and press Enter to start.
                </Text>
              </Box>
            )}

            <OffscreenFreeze frozen={state.isFrozen}>
              {live.map((message) => (
                <MessageBubble key={message.id} message={message} contentExpanded={state.contentExpanded} />
              ))}
            </OffscreenFreeze>

            {state.approvalReq && (
              <Box flexDirection="column" flexShrink={0} paddingX={1} paddingY={1}>
                <ApprovalPrompt
                  req={state.approvalReq}
                  onChoice={handleApprovalChoice}
                />
              </Box>
            )}

            {state.agentPicker && (
              <Box flexDirection="column" flexShrink={0} paddingX={1} paddingY={1}>
                <SubAgentPicker
                  onSelect={(agentId) => {
                    dispatch({ type: 'HIDE_AGENT_PICKER' });
                    dispatch({ type: 'OPEN_SUBAGENT_VIEW', agentId });
                  }}
                  onCancel={() => dispatch({ type: 'HIDE_AGENT_PICKER' })}
                />
              </Box>
            )}

            {state.teamPicker && (
              <Box flexDirection="column" flexShrink={0} paddingX={1} paddingY={1}>
                <TeamAgentPicker
                  onSelect={(agentId) => {
                    dispatch({ type: 'HIDE_TEAM_PICKER' });
                    dispatch({ type: 'OPEN_SUBAGENT_VIEW', agentId });
                  }}
                  onCancel={() => dispatch({ type: 'HIDE_TEAM_PICKER' })}
                />
              </Box>
            )}
          </>
        )}
      </Box>

      <TaskPanel
        dismissed={state.taskPanelDismissed}
        onDismissReset={handleTaskDismissReset}
      />

      <TeamPanel
        dismissed={state.teamPanelDismissed}
        onDismissReset={handleTeamDismissReset}
      />

      <CommandHint inputText={state.inputText} selectedIndex={state.commandPickerIndex} />
      <InputBox
        inputText={state.inputText}
        cursorPosition={state.cursorPosition}
        isStreaming={state.isStreaming}
      />

      <Box marginTop={1}>
        <StatusBar
          model={state.model}
          isStreaming={state.isStreaming}
          isFrozen={state.isFrozen}
          error={state.error}
          totalChars={stats.totalChars}
          inputTokens={stats.inputTokens}
          outputTokens={stats.outputTokens}
          realUsage={stats.realUsage}
          accumulatedCost={stats.accumulatedCost}
          currency={config.currency}
          maxContext={config.maxContext}
        />
      </Box>
    </Box>
  );
}
