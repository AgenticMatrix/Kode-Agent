import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { OutputLine } from '../shared/OutputLine.js';
import type { ToolUseRendererProps } from '../types.js';

const MAX_DISPLAY_CHARS = 120;

function truncatePath(fp: string): string {
  if (fp.length <= MAX_DISPLAY_CHARS) return fp;
  return fp.slice(0, 60) + '...' + fp.slice(-60);
}

export function ReadRenderer(props: ToolUseRendererProps): React.ReactNode {
  const fp = (props.input.file_path as string) || '';

  const truncatedPath = fp ? truncatePath(fp) : '';

  const isExecuting = props.state === 'executing';
  const isDone = props.state === 'done';
  const hasPath = !!fp;
  const result = props.result;

  const isActive = isExecuting && hasPath;

  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (isActive) setTick(0);
  }, [isActive]);

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

  const COLLAPSE_THRESHOLD = 3;

  const resultLines = result?.content
    ? result.content.split('\n').filter((l) => l !== '')
    : [];
  const hasResult = isDone && result && resultLines.length > 0;
  const tooLong = resultLines.length > COLLAPSE_THRESHOLD;
  const displayLines = tooLong ? resultLines.slice(0, COLLAPSE_THRESHOLD) : resultLines;
  const hiddenCount = resultLines.length - COLLAPSE_THRESHOLD;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {hasPath ? (
        <>
          <Text>
            <Text color={indicatorColor}>{indicator} </Text>
            <Text bold>Read</Text>
            ({truncatedPath})
          </Text>
          {isExecuting ? (
            <Text dimColor>  Reading  {elapsedSecs}s</Text>
          ) : isDone ? (
            <Text dimColor>  Reading consumed {elapsedSecs}s</Text>
          ) : null}
          {hasResult ? (
            <Box flexDirection="column" paddingLeft={2}>
              {displayLines.map((line, i) => (
                <OutputLine key={`out-${i}`} line={line} />
              ))}
              {tooLong ? (
                <Text dimColor>... {hiddenCount} more lines</Text>
              ) : null}
            </Box>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}
