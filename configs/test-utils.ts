/**
 * Test utility helpers for Kode Agent.
 *
 * Provides factory functions and assertion helpers commonly used across
 * the test suite. Modeled after Hermes Agent's e2e/conftest.py fixture
 * factories (make_source, make_session_entry, make_event, etc.).
 */

import { vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// Types (mirror shared types to keep test utils self-contained)
// ═══════════════════════════════════════════════════════════════════════════

export interface TestMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | TestContentBlock[];
}

export interface TestContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

export interface TestAgentContext {
  sessionId: string;
  workingDir: string;
  maxTurns: number;
  tools: string[];
  model: string;
  provider: string;
  messages: TestMessage[];
}

export interface MockAgentResponse {
  content: string;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
  toolCalls?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  usage?: { inputTokens: number; outputTokens: number };
}

// ═══════════════════════════════════════════════════════════════════════════
// Factory functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a minimal test context for agent loop tests.
 * Override fields as needed in individual tests.
 */
export function createTestContext(
  overrides: Partial<TestAgentContext> = {},
): TestAgentContext {
  return {
    sessionId: `test-session-${Date.now()}`,
    workingDir: '/tmp/kode-test-workspace',
    maxTurns: 10,
    tools: ['read', 'write', 'bash', 'grep', 'glob'],
    model: 'deepseek-v4-pro',
    provider: 'deepseek',
    messages: [],
    ...overrides,
  };
}

/**
 * Create a mock agent response (text completion, no tool calls).
 */
export function mockAgentResponse(
  content: string,
  overrides: Partial<MockAgentResponse> = {},
): MockAgentResponse {
  return {
    content,
    stopReason: 'end_turn',
    usage: { inputTokens: 100, outputTokens: 50 },
    ...overrides,
  };
}

/**
 * Create a mock agent response with tool calls.
 */
export function mockAgentToolUse(
  toolCalls: MockAgentResponse['toolCalls'],
  overrides: Partial<MockAgentResponse> = {},
): MockAgentResponse {
  return {
    content: '',
    stopReason: 'tool_use',
    toolCalls,
    usage: { inputTokens: 100, outputTokens: 50 },
    ...overrides,
  };
}

/**
 * Create a standard assistant message.
 */
export function createAssistantMessage(
  content: string,
  toolCalls?: MockAgentResponse['toolCalls'],
): TestMessage {
  const blocks: TestContentBlock[] = [];
  if (content) {
    blocks.push({ type: 'text', text: content });
  }
  if (toolCalls) {
    for (const tc of toolCalls) {
      blocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.input,
      });
    }
  }
  return { role: 'assistant', content: blocks };
}

/**
 * Create a user message.
 */
export function createUserMessage(content: string): TestMessage {
  return { role: 'user', content };
}

/**
 * Create a tool result message.
 */
export function createToolResult(
  toolUseId: string,
  content: string,
  isError = false,
): TestMessage {
  return {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content,
        is_error: isError,
      },
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Mock helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a mock AbortController that is not aborted.
 */
export function createMockAbortController(): AbortController {
  const controller = new AbortController();
  return controller;
}

/**
 * Create a mock AbortController that is already aborted.
 */
export function createAbortedController(): AbortController {
  const controller = new AbortController();
  controller.abort();
  return controller;
}

/**
 * Create a simple mock function that records its calls.
 * Wraps vi.fn() for convenience.
 */
export function createMockFn<T extends (...args: unknown[]) => unknown>() {
  return vi.fn<T>();
}

/**
 * Create a mock timer context (fake timers).
 * Returns a cleanup function.
 */
export function useFakeTimers(): () => void {
  vi.useFakeTimers();
  return () => vi.useRealTimers();
}

// ═══════════════════════════════════════════════════════════════════════════
// Assertion helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Assert that an async function rejects with a specific error message.
 */
export async function assertRejects(
  fn: () => Promise<unknown>,
  messageOrPattern: string | RegExp,
): Promise<void> {
  try {
    await fn();
    throw new Error('Expected function to reject, but it resolved');
  } catch (error) {
    if (error instanceof Error && error.message === 'Expected function to reject, but it resolved') {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (typeof messageOrPattern === 'string') {
      if (!errorMessage.includes(messageOrPattern)) {
        throw new Error(
          `Expected error message to include "${messageOrPattern}", got "${errorMessage}"`,
        );
      }
    } else {
      if (!messageOrPattern.test(errorMessage)) {
        throw new Error(
          `Expected error message to match ${messageOrPattern}, got "${errorMessage}"`,
        );
      }
    }
  }
}

/**
 * Assert that a value is within a tolerance of an expected value.
 */
export function assertApproximately(
  actual: number,
  expected: number,
  tolerance: number,
  label = 'value',
): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      `Expected ${label} to be ${expected} ± ${tolerance}, got ${actual}`,
    );
  }
}
