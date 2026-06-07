/**
 * Integration-style tests: verify that the shared utilities work together
 * as they would in the real Agent Loop pipeline.
 */
import { describe, expect, it } from 'vitest';
import { normalizeMessagesForApi, validateMessageSequence, validateToolResultPairing } from '../utils/messages.js';
import { diffText } from '../utils/diff.js';
import { checkTokenBudget } from '../utils/tokenizer.js';
import type { InternalMessage } from '../utils/messages.js';

describe('Agent Loop integration - message pipeline', () => {
  it('should process a complete agent turn: user → assistant (tool_use) → user (tool_result)', () => {
    // Simulate the message flow for one agent turn
    const messages: InternalMessage[] = [
      {
        role: 'user',
        content: 'Read the file at /tmp/test.txt',
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_read_1',
            name: 'read_file',
            input: { path: '/tmp/test.txt' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_read_1',
            content: 'Hello World\nThis is a test file.',
          },
        ],
      },
      {
        role: 'assistant',
        content: 'The file contains: "Hello World" and "This is a test file."',
      },
    ];

    // 1. Validate message sequence
    const seqResult = validateMessageSequence(messages);
    expect(seqResult.valid).toBe(true);

    // 2. Normalize for API
    const apiMessages = normalizeMessagesForApi(messages);
    expect(apiMessages.length).toBeGreaterThan(0);

    // 3. Validate tool result pairing
    const pairing = validateToolResultPairing(apiMessages);
    expect(pairing.valid).toBe(true);
  });

  it('should detect incomplete tool call cycle', () => {
    const messages: InternalMessage[] = [
      { role: 'user', content: 'Run a command' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_bash_1',
            name: 'bash',
            input: { command: 'ls -la' },
          },
        ],
      },
      // Missing tool_result — this is a real bug scenario
      { role: 'assistant', content: 'I ran the command.' },
    ];

    // Validate catches the consecutive assistant messages
    const seqResult = validateMessageSequence(messages);
    expect(seqResult.valid).toBe(false);

    // Normalize then check pairing
    const apiMessages = normalizeMessagesForApi(messages);
    const pairing = validateToolResultPairing(apiMessages);
    expect(pairing.valid).toBe(false);
    expect(pairing.unmatchedToolUses).toContain('call_bash_1');
  });

  it('should handle file editing workflow', () => {
    const originalContent = 'function hello() {\n  console.log("hello");\n}\n';
    const modifiedContent = 'function hello() {\n  console.log("hello, world!");\n}\n';

    const diffResult = diffText(originalContent, modifiedContent);
    expect(diffResult.changeCount).toBeGreaterThan(0);

    // The diff should detect the change
    const hasDelete = diffResult.edits.some((e) => e.type === 'delete');
    const hasInsert = diffResult.edits.some((e) => e.type === 'insert');
    expect(hasDelete || hasInsert).toBe(true);
  });

  it('should handle token budget check for large tool results', () => {
    const largeContent = 'x'.repeat(10000);
    const budgetResult = checkTokenBudget(largeContent, 1000, 'gpt-4');

    expect(budgetResult.fits).toBe(false);
    expect(budgetResult.tokens).toBeGreaterThan(1000);
  });

  it('should handle empty message sequences gracefully', () => {
    const seqResult = validateMessageSequence([]);
    expect(seqResult.valid).toBe(true);

    const apiMessages = normalizeMessagesForApi([]);
    expect(apiMessages).toHaveLength(0);

    const pairing = validateToolResultPairing([]);
    expect(pairing.valid).toBe(true);
  });
});
