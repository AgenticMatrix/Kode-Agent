import React from 'react';
import { Box, Text } from 'ink';
import { OutputLine } from '../shared/OutputLine.js';
import { ToolResultCard } from '../shared/ToolResultCard.js';
import type { ToolResultRendererProps } from '../types.js';

/**
 * Bash tool result renderer.
 *
 * Composes shared primitives to display:
 *  - ToolResultCard (header with tool name + duration)
 *  - stdout lines via OutputLine (white / default)
 *  - stderr lines via OutputLine (dim yellow, from metadata)
 *  - Exit code badge (red, on error)
 *  - Empty output → "Done" (green) or "(error — no output)" (red)
 */
export function BashResultRenderer(props: ToolResultRendererProps): React.ReactNode {
  const { content, isError, duration, metadata } = props;
  const stderr = metadata?.stderr as string | undefined;
  const exitCode = metadata?.exitCode as number | null | undefined;
  const timedOut = metadata?.timedOut as boolean | undefined;

  const stdoutLines = content ? content.split('\n').filter(l => l !== '') : [];
  const stderrLines = stderr ? stderr.split('\n').filter(l => l !== '') : [];
  const emptiness = stdoutLines.length === 0 && stderrLines.length === 0;

  return (
    <ToolResultCard toolName="bash" duration={duration} isError={isError}>
      <Box flexDirection="column">
        {/* Timed out message */}
        {timedOut ? (
          <Box marginBottom={1}>
            <Text color="red">Command timed out</Text>
          </Box>
        ) : null}

        {/* Completely empty output */}
        {emptiness ? (
          <Text color={isError ? 'red' : 'green'} dimColor>
            {isError ? '(error — no output)' : 'Done'}
          </Text>
        ) : null}

        {/* Standard output */}
        {stdoutLines.length > 0 ? (
          <Box flexDirection="column">
            {stdoutLines.map((line, i) => (
              <OutputLine key={`out-${i}`} line={line} />
            ))}
          </Box>
        ) : null}

        {/* Standard error (shown in dim yellow below stdout) */}
        {stderrLines.length > 0 ? (
          <Box flexDirection="column" marginTop={stdoutLines.length > 0 ? 1 : 0}>
            {stderrLines.map((line, i) => (
              <OutputLine key={`err-${i}`} line={line} isStderr />
            ))}
          </Box>
        ) : null}

        {/* Exit code badge (only on error and when exit code is meaningful) */}
        {isError && exitCode != null ? (
          <Box marginTop={(stdoutLines.length > 0 || stderrLines.length > 0) ? 1 : 0}>
            <Text color="red">Exit code: {exitCode}</Text>
          </Box>
        ) : null}
      </Box>
    </ToolResultCard>
  );
}
