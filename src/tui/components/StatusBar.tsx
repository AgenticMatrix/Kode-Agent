import { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';

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
}

/** Rough token estimate: ~4 characters per token. */
function estimateTokens(charCount: number): number {
  return Math.ceil(charCount / 4);
}

/** Default DeepSeek pricing per 1M tokens (configurable per provider later). */
const INPUT_PRICE_PER_M = 0.50;   // $0.50 / 1M input tokens
const OUTPUT_PRICE_PER_M = 2.00;  // $2.00 / 1M output tokens

/** Format cost in dollars, max 3 decimal places. */
function formatCost(inputTokens: number, outputTokens: number): string {
  const cost =
    (inputTokens / 1_000_000) * INPUT_PRICE_PER_M +
    (outputTokens / 1_000_000) * OUTPUT_PRICE_PER_M;

  // Up to 3 decimals, strip trailing zeros
  const fixed = cost.toFixed(3);
  const stripped = fixed.replace(/\.?0+$/, '');
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
 * E.g. [████████░░] 80%
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
 * Timers update every second in real-time.
 */
export function StatusBar({ model, isStreaming, error, totalChars, inputTokens, outputTokens }: StatusBarProps) {
  const sessionStartRef = useRef(Date.now());
  // Session seconds — derived from start ref on each render (no dedicated timer).
  const [sessionSeconds, setSessionSeconds] = useState(0);
  // Response timer — ticks only while streaming
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

  // Tick timer ONLY during streaming to avoid re-renders that disrupt
  // terminal text selection during idle time.
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

  const usedTokens = estimateTokens(totalChars);
  // Max context: deepseek-v4-pro is ~128K; default to 128K
  const maxTokens = 131072;
  const usedK = (usedTokens / 1024).toFixed(1);
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
      <ContextBar used={usedTokens} max={maxTokens} />
      <Text dimColor> {usedK}K/{maxK}K</Text>

      <Sep />

      <Text dimColor>
        {formatCost(inputTokens, outputTokens)} $
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
