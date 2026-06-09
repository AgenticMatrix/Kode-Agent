import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { OutputLine } from '../shared/OutputLine.js';
import type { ToolUseRendererProps } from '../types.js';

const MAX_DISPLAY_CHARS = 60;
const COLLAPSE_THRESHOLD = 3;

function extractCommentLabel(command: string): string | null {
  const lines = command.split('\n');
  let best: string | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') && !trimmed.startsWith('#!')) {
      const label = trimmed.replace(/^#+\s*/, '');
      if (!best || label.length > best.length) {
        best = label;
      }
    }
  }
  return best;
}

function getCommand(input: Record<string, unknown>): string {
  const direct = input.command as string | undefined;
  if (direct) return direct;

  const partial = input._partial as string | undefined;
  if (partial) {
    try {
      const parsed = JSON.parse(partial);
      return (parsed.command as string) ?? '';
    } catch {
      return '';
    }
  }

  return '';
}

export function BashRenderer(props: ToolUseRendererProps): React.ReactNode {
  const command = getCommand(props.input);
  const description =
    (props.input.description as string) ||
    (command ? extractCommentLabel(command) : null);

  const truncate = (s: string) =>
    s.length > MAX_DISPLAY_CHARS ? s.slice(0, MAX_DISPLAY_CHARS).trim() + '…' : s;
  const truncatedCmd = command ? truncate(command) : '';
  const truncatedDesc = description ? truncate(description) : null;

  const isExecuting = props.state === 'executing';
  const isDone = props.state === 'done';
  const hasCommand = !!command;
  const result = props.result;

  // Timer starts only when BOTH executing AND command is available.
  const isActive = isExecuting && hasCommand;

  const [tick, setTick] = useState(0);

  // Reset tick when timer becomes active
  useEffect(() => {
    if (isActive) setTick(0);
  }, [isActive]);

  // Continuous interval — same pattern as StatusBar
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  useEffect(() => {
    const id = setInterval(() => {
      if (isActiveRef.current) {
        setTick((t) => t + 1);
      }
    }, 100);
    return () => clearInterval(id);
  }, []);

  const elapsedSecs = (tick * 0.1).toFixed(1);
  const blinkOn = Math.floor(tick / 5) % 2 === 0;

  const indicator = isDone ? '●' : blinkOn ? '●' : '○';
  const indicatorColor = isDone ? 'green' : 'yellow';

  const indent = ' '.repeat(5);

  const displayCmd = ((): string => {
    if (truncatedDesc) return truncatedCmd;
    const lines = truncatedCmd.split('\n');
    return lines.length > 2
      ? lines.slice(0, 2).join('\n') + '…'
      : truncatedCmd;
  })();

  // ── Inline result display ──────────────────────────────────────
  const resultContent = result?.content ?? '';
  const resultMetadata = result?.metadata;
  const stderr = resultMetadata?.stderr as string | undefined;
  const exitCode = resultMetadata?.exitCode as number | null | undefined;
  const timedOut = resultMetadata?.timedOut as boolean | undefined;

  const stdoutLines = resultContent ? resultContent.split('\n').filter(l => l !== '') : [];
  const stderrLines = stderr ? stderr.split('\n').filter(l => l !== '') : [];
  const emptiness = stdoutLines.length === 0 && stderrLines.length === 0;

  const tooLong = stdoutLines.length > COLLAPSE_THRESHOLD;
  const displayOutLines = tooLong ? stdoutLines.slice(0, COLLAPSE_THRESHOLD) : stdoutLines;
  const hiddenCount = stdoutLines.length - COLLAPSE_THRESHOLD;

  const hasResult = isDone && result;

  // Always return JSX to avoid null→JSX transition that may cause remount.
  // Render an empty placeholder until command is available.
  return (
    <Box flexDirection="column" marginBottom={1}>
      {hasCommand ? (
        <>
          <Text>
            <Text color={indicatorColor}>{indicator} </Text>
            <Text bold>Bash</Text>
            ({truncatedDesc ? `${truncatedDesc},\n${indent}${displayCmd}` : displayCmd})
          </Text>
          {isExecuting ? (
            <Text dimColor>  running  {elapsedSecs}s</Text>
          ) : isDone ? (
            <Text dimColor>  Execution consumed {elapsedSecs}s</Text>
          ) : null}

          {/* Inline result content */}
          {hasResult ? (
            <Box flexDirection="column" paddingLeft={2}>
              {timedOut ? (
                <Text color="red">Command timed out</Text>
              ) : null}
              {emptiness ? (
                <Text color={result.isError ? 'red' : 'green'} dimColor>
                  {result.isError ? '(error — no output)' : 'Done'}
                </Text>
              ) : null}
              {displayOutLines.map((line, i) => (
                <OutputLine key={`out-${i}`} line={line} />
              ))}
              {tooLong ? (
                <Text dimColor>... {hiddenCount} more lines</Text>
              ) : null}
              {stderrLines.length > 0 ? (
                <Box flexDirection="column" marginTop={stdoutLines.length > 0 ? 1 : 0}>
                  {stderrLines.map((line, i) => (
                    <OutputLine key={`err-${i}`} line={line} isStderr />
                  ))}
                </Box>
              ) : null}
              {result.isError && exitCode != null ? (
                <Box marginTop={(stdoutLines.length > 0 || stderrLines.length > 0) ? 1 : 0}>
                  <Text color="red">Exit code: {exitCode}</Text>
                </Box>
              ) : null}
            </Box>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}
