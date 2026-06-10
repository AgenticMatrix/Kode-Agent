import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { ShellTimeDisplay, formatDuration } from '../../shared/ShellTimeDisplay.js';
import type { ToolUseRenderer } from '../../types.js';
import { getSubAgentRegistry } from './registry-ref.js';

const AGENT_ICONS: Record<string, string> = {
  explore: '🔍',
  plan: '📋',
  'general-purpose': '🔧',
};

const AGENT_LABELS: Record<string, string> = {
  explore: 'Explore',
  plan: 'Plan',
  'general-purpose': 'General-purpose',
};

const RESULT_COLLAPSE = 12;

export const AgentSpawnRenderer: ToolUseRenderer = (props) => {
  // Don't render a placeholder while the LLM is still streaming the input.
  if (props.state === 'pending') return null;

  const prompt = props.input.prompt as string ?? '';
  const agentType = props.input.agent_type as string ?? 'general-purpose';
  const icon = AGENT_ICONS[agentType] ?? '🤖';
  const label = AGENT_LABELS[agentType] ?? agentType;
  const summary = prompt.length > 80 ? prompt.slice(0, 77) + '...' : prompt;

  const isDone = props.state === 'done';
  const isExecuting = props.state === 'executing';
  const resultContent: string | undefined = isDone ? (props.result?.content as string) : undefined;
  const resultLines = resultContent ? resultContent.split('\n') : [];
  const tooLong = resultLines.length > RESULT_COLLAPSE;
  const displayLines = tooLong ? resultLines.slice(0, RESULT_COLLAPSE) : resultLines;

  // ── Live elapsed timer ──────────────────────────────────────
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isExecuting) return;
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - start), 100);
    return () => clearInterval(timer);
  }, [isExecuting]);

  // ── Live turn / tool counts from registry ───────────────────
  const [liveStats, setLiveStats] = useState<{ turnCount: number; toolCount: number } | null>(null);
  useEffect(() => {
    if (!isExecuting) return;
    const registry = getSubAgentRegistry();
    if (!registry) return;

    const poll = () => {
      const agents = registry.listByStatus('running');
      const match = agents.find(a => a.prompt === prompt && a.agentType === agentType);
      if (match) {
        setLiveStats({ turnCount: match.turnCount, toolCount: match.toolCount });
      }
    };
    poll();
    const timer = setInterval(poll, 500);
    return () => clearInterval(timer);
  }, [isExecuting, prompt, agentType]);

  // ── Duration display value ──────────────────────────────────
  const displayDuration = isDone && props.duration !== undefined
    ? props.duration
    : isExecuting ? elapsed : undefined;

  // ── Progress line ───────────────────────────────────────────
  let progressNode: React.ReactNode = null;
  if (isExecuting) {
    if (liveStats && liveStats.turnCount > 0) {
      progressNode = React.createElement(
        Text,
        { color: 'yellow' },
        `  ${liveStats.turnCount} LLM turns, ${liveStats.toolCount} tools used.`,
      );
    } else {
      progressNode = React.createElement(Text, { color: 'yellow' }, '  Running...');
    }
  }

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: isExecuting ? 'yellow' : props.state === 'error' ? 'red' : 'blue',
      paddingX: 1,
      width: '90%',
    },
    // Header: icon + label | duration
    React.createElement(
      Box,
      { flexDirection: 'row', justifyContent: 'space-between' },
      React.createElement(Text, { bold: true, color: 'cyan' }, `${icon} ${label}`),
      displayDuration !== undefined
        ? isExecuting
          ? React.createElement(Text, { dimColor: true }, `⏱ ${formatDuration(displayDuration)}`)
          : React.createElement(ShellTimeDisplay, { durationMs: displayDuration })
        : null,
    ),
    // Prompt summary
    React.createElement(Text, { dimColor: true }, summary),
    // Progress indicator (live turn/tool counts or Running...)
    progressNode,
    // Done: show result content inside the same box
    isDone && resultLines.length > 0 && React.createElement(
      Box,
      { paddingLeft: 1, flexDirection: 'column', marginTop: 0 },
      ...displayLines.map((line, i) =>
        React.createElement(Text, { key: i, color: 'white' }, line),
      ),
      tooLong && React.createElement(
        Text,
        { dimColor: true },
        `... ${resultLines.length - RESULT_COLLAPSE} more lines`,
      ),
    ),
    isDone && resultLines.length === 0 && React.createElement(Text, { color: 'green' }, '  Done'),
    // Error
    props.state === 'error' && props.result?.isError &&
      React.createElement(Text, { color: 'red' }, `  Error: ${(props.result.content as string).slice(0, 100)}`),
  );
};
