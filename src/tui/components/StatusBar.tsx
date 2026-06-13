import { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';

import type { TokenUsage } from '../../types.js';

interface StatusBarProps {
  model: string;
  isStreaming: boolean;
  error: string | null;
  /** Total character count of all messages (for context estimation). */
  totalChars: number;
  /** Estimated input tokens (user messages). */
  inputTokens: number;
  /** Estimated output tokens (assistant messages). */
  outputTokens: number;
  /** Real token usage from latest API response (for ctx display). */
  realUsage: TokenUsage;
  /** Accumulated total cost across all turns. */
  accumulatedCost: number;
}

/** Rough token estimate: ~4 characters per token. */
function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / 4);
}

/** Format accumulated cost in dollars. */
function formatCost(cost: number): string {
  const fixed = cost.toFixed(4);
  const stripped = fixed.replace(/\.?0+$/, '').replace(/\.?0+$/, '');
  return stripped || '0';
}

/** Format seconds into a readable duration. */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m ${s}s`;
}

/**
 * Render a battery-like bar for context usage.
 * Uses real API token counts (including cache) for the ctx total.
 */
function ContextBar({ used, max }: { used: number; max: number }) {
  const barWidth = 8;
  const ratio = Math.min(used / max, 1);
  const filled = Math.round(ratio * barWidth);
  const empty = barWidth - filled;
  const pct = Math.round(ratio * 100);

  const barColor = ratio > 0.9 ? 'red' : ratio > 0.7 ? 'yellow' : 'green';

  return (
    <Text>
      <Text color={barColor}>{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(empty)}</Text>
      <Text dimColor> {pct}%</Text>
    </Text>
  );
}

/**
 * Bottom status bar showing:
 *   Ready | ctx [████░░░░] 40% 3.2K/128K | 0.0042 $ | 12m 34s | ⏲ 3s | Model: xxx ✓ | Ctrl+C to exit
 *
 * ctx = cache_read + cache_creation + output + input (real API tokens).
 * Timers update every second in real-time.
 */
export function StatusBar({ model, isStreaming, error, totalChars, inputTokens, outputTokens, realUsage, accumulatedCost }: StatusBarProps) {
  const sessionStartRef = useRef(Date.now());
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [responseSeconds, setResponseSeconds] = useState(0);
  const streamStartRef = useRef<number | null>(null);

  // Track streaming start/stop
  useEffect(() => {
    if (isStreaming && streamStartRef.current === null) {
      streamStartRef.current = Date.now();
      setResponseSeconds(0);
    } else if (!isStreaming) {
      streamStartRef.current = null;
      setResponseSeconds(0);
    }
  }, [isStreaming]);

  // Tick timer ONLY during streaming
  useEffect(() => {
    if (!isStreaming) return;

    const id = setInterval(() => {
      setSessionSeconds(
        Math.floor((Date.now() - sessionStartRef.current) / 1000),
      );
      if (streamStartRef.current !== null) {
        setResponseSeconds(
          Math.floor((Date.now() - streamStartRef.current) / 1000),
        );
      }
    }, 1000);
    return () => clearInterval(id);
  }, [isStreaming]);

  // ctx = cache_read + cache_creation + output + input (real API tokens)
  const ctxTokens =
    realUsage.cacheReadInputTokens +
    realUsage.cacheCreationInputTokens +
    realUsage.outputTokens +
    realUsage.inputTokens;

  const maxTokens = 131072;
  const usedK = (ctxTokens / 1024).toFixed(1);
  const maxK = (maxTokens / 1024).toFixed(0);

  const Sep = () => <Text dimColor color="grey"> │ </Text>;

  return (
    <Box paddingX={1} flexDirection="row">
      {error ? (
        <Text color="red">⚠ {error}</Text>
      ) : isStreaming ? (
        <Text color="yellow" dimColor>● Streaming</Text>
      ) : (
        <Text color="green" dimColor>✓ Ready</Text>
      )}

      <Sep />

      <Text dimColor>ctx </Text>
      <ContextBar used={ctxTokens} max={maxTokens} />
      <Text dimColor> {usedK}K/{maxK}K</Text>

      <Sep />

      <Text dimColor>
        {formatCost(accumulatedCost)} $
      </Text>

      <Sep />

      <Text dimColor>{formatDuration(sessionSeconds)}</Text>

      <Sep />

      {isStreaming ? (
        <Text color="yellow">⏲ {formatDuration(responseSeconds)}</Text>
      ) : (
        <Text dimColor>⏲ 0s</Text>
      )}

      <Sep />

      <Text>
        <Text dimColor>Model: </Text>
        <Text color="magenta" bold>{model}</Text>
        {!error && !isStreaming ? (
          <Text color="green" dimColor> ✓</Text>
        ) : null}
      </Text>

      <Sep />

      <Text dimColor>Ctrl+C to exit</Text>
    </Box>
  );
}
