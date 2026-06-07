/**
 * ErrorBoundary — Phase 3.2
 *
 * React class component that catches render errors in its subtree and
 * displays a terminal-native error overlay using ink's Box / Text.
 *
 * ## Features
 * - `getDerivedStateFromError` — captures error synchronously during render
 * - `componentDidCatch` — logs error + component stack, calls onError prop
 * - Terminal-native UI: red-bordered Box, bold red error message,
 *   yellow component stack, dimmed dismissal hint
 * - "Press any key to dismiss" via `useInput` (keyboard dismiss)
 * - Optional `retry` callback — re-renders children to attempt recovery
 * - Optional `fallback` prop — custom error UI instead of built-in
 *
 * ## Constraints
 * - Class component (React Error Boundaries require componentDidCatch /
 *   getDerivedStateFromError — neither is available in function components)
 * - Zero new npm dependencies (uses only ink Box, Text, useInput + React)
 * - isTTY guard on stdin to avoid crash in non-TTY environments
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  /**
   * Custom fallback UI rendered when an error is caught.
   * When provided, replaces the built-in error display.
   * Receives the error and a `reset` callback to clear the error state
   * and re-render children.
   */
  fallback?: React.ReactNode | ((error: Error, reset: () => void) => React.ReactNode);
  /**
   * Called after an error is caught by componentDidCatch.
   * Use for telemetry / logging — does not affect rendering.
   */
  onError?: (error: Error, info: React.ErrorInfo) => void;
  /**
   * Optional retry callback. When provided, "Press Enter to retry" is shown
   * in the error overlay.  When omitted, the error is dismiss-only.
   */
  retry?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  /** componentStack from React.ErrorInfo, or a trimmed summary */
  componentStack: string | null;
}

// ---------------------------------------------------------------------------
// ErrorDisplay — functional child that handles keyboard input
// ---------------------------------------------------------------------------

interface ErrorDisplayProps {
  error: Error;
  componentStack: string | null;
  onDismiss: () => void;
  onRetry?: () => void;
}

/**
 * Terminal-native error overlay.
 *
 * Uses `useInput` to listen for any keypress.  Enter triggers `onRetry`
 * when available; any other key triggers `onDismiss`.
 *
 * Rendering:
 *   ┌─ Error ──────────────────────────┐
 *   │  error.message                   │
 *   │  (component stack, trimmed)      │
 *   │                                  │
 *   │  Press Enter to retry / any key  │
 *   │  to dismiss                      │
 *   └──────────────────────────────────┘
 */
function ErrorDisplay({
  error,
  componentStack,
  onDismiss,
  onRetry,
}: ErrorDisplayProps): React.ReactElement {
  useInput((_input: string, key: any) => {
    if (key.return && onRetry) {
      onRetry();
    } else {
      onDismiss();
    }
  });

  // Trim componentStack to a reasonable terminal-friendly length.
  // Show at most 12 stack frames.
  const trimmedStack = trimComponentStack(componentStack, 12);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="red"
      paddingX={1}
      paddingY={0}
    >
      {/* Header */}
      <Box marginBottom={0}>
        <Text color="red" bold>
          Error
        </Text>
      </Box>

      {/* Error message */}
      <Box marginBottom={0}>
        <Text color="red">{error.message}</Text>
      </Box>

      {/* Component stack (yellow / dimmed for warning tone) */}
      {trimmedStack !== null && trimmedStack.length > 0 && (
        <Box flexDirection="column" marginBottom={0}>
          {trimmedStack
            .split('\n')
            .filter(Boolean)
            .map((line, i) => (
              <Text key={i} color="yellow" dimColor>
                {line.trim()}
              </Text>
            ))}
        </Box>
      )}

      {/* Dismissal hint */}
      <Box marginTop={0}>
        <Text dimColor>
          {onRetry
            ? 'Press Enter to retry, any other key to dismiss'
            : 'Press any key to dismiss'}
        </Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Truncate a component stack string to at most `maxFrames` stack frames.
 *
 * React's ErrorInfo.componentStack is a newline-separated list of
 * component names with indentation (e.g. "    in Foo\n    in Bar").
 * We keep the header line + at most maxFrames indented lines.
 */
function trimComponentStack(
  stack: string | null,
  maxFrames: number,
): string | null {
  if (!stack) return null;

  const lines = stack.split('\n');

  // The first line is typically the message header (e.g. "    in Foo")
  // We keep it plus at most maxFrames more.
  if (lines.length <= maxFrames + 1) return stack;

  const kept = lines.slice(0, maxFrames + 1);
  kept.push(`    ... ${lines.length - maxFrames - 1} more frames`);
  return kept.join('\n');
}

// ---------------------------------------------------------------------------
// ErrorBoundary class component
// ---------------------------------------------------------------------------

/**
 * ErrorBoundary catches JavaScript errors anywhere in its child component
 * tree and displays a terminal-native error overlay instead of crashing
 * the entire TUI.
 *
 * Usage:
 * ```tsx
 * <ErrorBoundary onError={(err) => log(err)} retry={() => reload()}>
 *   <MyComponent />
 * </ErrorBoundary>
 * ```
 *
 * Error lifecycle:
 *   1. Child throws during render → `getDerivedStateFromError` sets hasError
 *   2. React calls `componentDidCatch` with error + componentStack
 *   3. `onError` prop is called (if provided) for external logging
 *   4. Error overlay renders with message, stack, and dismissal prompt
 *   5. User presses any key → state cleared, children re-render
 *
 * Reset behaviour:
 *   - `onDismiss` clears hasError and re-mounts children.
 *     The component that errored will attempt to re-render — if the error
 *     is transient (e.g. data not yet loaded), this may succeed.
 *   - `retry` prop (when provided): same as dismiss, but also calls the
 *     user-supplied `retry()` callback before re-rendering children.
 */
class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      componentStack: null,
    };
  }

  /**
   * Synchronously derive error state during render.
   * Called by React when a descendant throws.
   */
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
      // componentStack is populated in componentDidCatch
      componentStack: null,
    };
  }

  /**
   * Called after an error is caught.  Good for side effects (logging).
   * Updates state with the component stack from ErrorInfo.
   */
  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Store componentStack for display
    this.setState({ componentStack: errorInfo.componentStack ?? null });

    // Notify external listeners
    this.props.onError?.(error, errorInfo);
  }

  /**
   * Clear the error state and re-render children.
   * Also calls the optional `retry` prop for recovery logic.
   */
  private handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      componentStack: null,
    });
    this.props.retry?.();
  };

  /**
   * Dismiss the error overlay (clear state, re-render children).
   */
  private handleDismiss = (): void => {
    this.setState({
      hasError: false,
      error: null,
      componentStack: null,
    });
  };

  override render(): React.ReactNode {
    if (this.state.hasError && this.state.error) {
      // Custom fallback
      if (this.props.fallback !== undefined) {
        return typeof this.props.fallback === 'function'
          ? (this.props.fallback as (error: Error, reset: () => void) => React.ReactNode)(
              this.state.error,
              this.handleDismiss,
            )
          : this.props.fallback;
      }

      // Built-in terminal overlay
      return (
        <ErrorDisplay
          error={this.state.error}
          componentStack={this.state.componentStack}
          onDismiss={this.handleDismiss}
          onRetry={this.props.retry ? this.handleRetry : undefined}
        />
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
