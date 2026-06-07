import { describe, expect, it } from 'vitest';
import {
  mergeConsecutiveMessages,
  normalizeMessagesForApi,
  prependUserContext,
  validateMessageSequence,
  validateToolResultPairing,
} from '../../utils/messages.js';
import type { ApiMessage, InternalMessage } from '../../utils/messages.js';

describe('messages', () => {
  describe('validateMessageSequence', () => {
    it('should accept empty message array', () => {
      const result = validateMessageSequence([]);
      expect(result.valid).toBe(true);
    });

    it('should reject message array starting with assistant', () => {
      const messages: InternalMessage[] = [
        { role: 'assistant', content: 'Hello' },
      ];
      const result = validateMessageSequence(messages);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('First message');
    });

    it('should accept valid alternating sequence', () => {
      const messages: InternalMessage[] = [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
        { role: 'user', content: 'How are you?' },
      ];
      const result = validateMessageSequence(messages);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject consecutive same-role messages', () => {
      const messages: InternalMessage[] = [
        { role: 'user', content: 'First' },
        { role: 'user', content: 'Second' },
      ];
      const result = validateMessageSequence(messages);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Consecutive'))).toBe(true);
    });

    it('should reject consecutive assistant messages', () => {
      const messages: InternalMessage[] = [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
        { role: 'assistant', content: 'Again' },
      ];
      const result = validateMessageSequence(messages);
      expect(result.valid).toBe(false);
    });

    it('should report multiple errors', () => {
      const messages: InternalMessage[] = [
        { role: 'assistant', content: 'Wrong start' },
        { role: 'assistant', content: 'Consecutive' },
      ];
      const result = validateMessageSequence(messages);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('normalizeMessagesForApi', () => {
    it('should filter out system messages', () => {
      const messages: InternalMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Hello' },
      ];
      const result = normalizeMessagesForApi(messages);
      expect(result).toHaveLength(1);
      expect(result[0]?.role).toBe('user');
    });

    it('should keep user and assistant messages', () => {
      const messages: InternalMessage[] = [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ];
      const result = normalizeMessagesForApi(messages);
      expect(result).toHaveLength(2);
    });

    it('should convert string content directly', () => {
      const messages: InternalMessage[] = [
        { role: 'user', content: 'plain text' },
      ];
      const result = normalizeMessagesForApi(messages);
      expect(result[0]?.content).toBe('plain text');
    });

    it('should convert text content blocks', () => {
      const messages: InternalMessage[] = [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello from block' }],
        },
      ];
      const result = normalizeMessagesForApi(messages);
      const content = result[0]?.content;
      expect(Array.isArray(content)).toBe(true);
      if (Array.isArray(content)) {
        expect(content[0]?.type).toBe('text');
        if (content[0]?.type === 'text') {
          expect(content[0]?.text).toBe('Hello from block');
        }
      }
    });

    it('should convert tool_use blocks', () => {
      const messages: InternalMessage[] = [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'call_1',
              name: 'read_file',
              input: { path: '/test.txt' },
            },
          ],
        },
      ];
      const result = normalizeMessagesForApi(messages);
      const content = result[0]?.content;
      expect(Array.isArray(content)).toBe(true);
      if (Array.isArray(content)) {
        expect(content[0]?.type).toBe('tool_use');
      }
    });

    it('should filter out null blocks (e.g., empty text)', () => {
      const messages: InternalMessage[] = [
        {
          role: 'user',
          content: [{ type: 'text', text: '' }],
        },
      ];
      const result = normalizeMessagesForApi(messages);
      const content = result[0]?.content;
      if (Array.isArray(content)) {
        expect(content).toHaveLength(0);
      }
    });

    it('should truncate tool results when maxToolResultTokens is set', () => {
      const longContent = 'x'.repeat(5000);
      const messages: InternalMessage[] = [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call_1',
              content: longContent,
            },
          ],
        },
      ];
      const result = normalizeMessagesForApi(messages, { maxToolResultTokens: 10 });
      const content = result[0]?.content;
      if (Array.isArray(content) && content[0]?.type === 'tool_result') {
        expect(content[0].content.length).toBeLessThan(longContent.length);
        expect(content[0].content.endsWith('...')).toBe(true);
      }
    });
  });

  describe('mergeConsecutiveMessages', () => {
    it('should handle single message', () => {
      const messages: ApiMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      const result = mergeConsecutiveMessages(messages);
      expect(result).toHaveLength(1);
    });

    it('should merge consecutive same-role messages', () => {
      const messages: ApiMessage[] = [
        { role: 'user', content: 'First' },
        { role: 'user', content: 'Second' },
      ];
      const result = mergeConsecutiveMessages(messages);
      expect(result).toHaveLength(1);
      expect(result[0]?.role).toBe('user');
    });

    it('should not merge different-role messages', () => {
      const messages: ApiMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'How are you?' },
      ];
      const result = mergeConsecutiveMessages(messages);
      expect(result).toHaveLength(3);
    });

    it('should merge multiple groups of consecutive messages', () => {
      const messages: ApiMessage[] = [
        { role: 'user', content: 'U1' },
        { role: 'user', content: 'U2' },
        { role: 'assistant', content: 'A1' },
        { role: 'assistant', content: 'A2' },
      ];
      const result = mergeConsecutiveMessages(messages);
      expect(result).toHaveLength(2);
    });

    it('should handle string content merging', () => {
      const messages: ApiMessage[] = [
        { role: 'user', content: 'Part1' },
        { role: 'user', content: 'Part2' },
      ];
      const result = mergeConsecutiveMessages(messages);
      expect(result[0]?.content).toBe('Part1\nPart2');
    });

    it('should handle array content merging', () => {
      const messages: ApiMessage[] = [
        {
          role: 'user',
          content: [{ type: 'text', text: 'First' }],
        },
        {
          role: 'user',
          content: [{ type: 'text', text: 'Second' }],
        },
      ];
      const result = mergeConsecutiveMessages(messages);
      expect(result).toHaveLength(1);
      const content = result[0]?.content;
      if (Array.isArray(content)) {
        expect(content).toHaveLength(1); // merged text blocks
        if (content[0]?.type === 'text') {
          expect(content[0]?.text).toContain('First');
          expect(content[0]?.text).toContain('Second');
        }
      }
    });
  });

  describe('validateToolResultPairing', () => {
    it('should accept empty array', () => {
      const result = validateToolResultPairing([]);
      expect(result.valid).toBe(true);
    });

    it('should detect unmatched tool uses', () => {
      const messages: ApiMessage[] = [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'call_1', name: 'read', input: {} },
          ],
        },
      ];
      const result = validateToolResultPairing(messages);
      expect(result.valid).toBe(false);
      expect(result.unmatchedToolUses).toContain('call_1');
    });

    it('should validate properly paired tool calls', () => {
      const messages: ApiMessage[] = [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'call_1', name: 'read', input: {} },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call_1',
              content: 'file contents',
            },
          ],
        },
      ];
      const result = validateToolResultPairing(messages);
      expect(result.valid).toBe(true);
    });

    it('should detect orphaned tool results', () => {
      const messages: ApiMessage[] = [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'orphan_call',
              content: 'orphan result',
            },
          ],
        },
      ];
      const result = validateToolResultPairing(messages);
      expect(result.valid).toBe(false);
      expect(result.orphanedToolResults).toContain('orphan_call');
    });

    it('should handle multiple tool calls', () => {
      const messages: ApiMessage[] = [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'call_1', name: 'read', input: {} },
            { type: 'tool_use', id: 'call_2', name: 'bash', input: {} },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call_1', content: 'result1' },
            { type: 'tool_result', tool_use_id: 'call_2', content: 'result2' },
          ],
        },
      ];
      const result = validateToolResultPairing(messages);
      expect(result.valid).toBe(true);
    });

    it('should detect partial results', () => {
      const messages: ApiMessage[] = [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'call_1', name: 'read', input: {} },
            { type: 'tool_use', id: 'call_2', name: 'bash', input: {} },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call_1', content: 'result1' },
          ],
        },
      ];
      const result = validateToolResultPairing(messages);
      expect(result.valid).toBe(false);
      expect(result.unmatchedToolUses).toContain('call_2');
    });
  });

  describe('prependUserContext', () => {
    it('should return original messages when context is empty', () => {
      const messages: InternalMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      const result = prependUserContext(messages, '');
      expect(result).toEqual(messages);
    });

    it('should return original messages when array is empty', () => {
      const result = prependUserContext([], 'context');
      expect(result).toHaveLength(0);
    });

    it('should prepend to user message with string content', () => {
      const messages: InternalMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      const result = prependUserContext(messages, 'System info');
      expect(result).toHaveLength(1);
      expect(result[0]?.role).toBe('user');
      expect(Array.isArray(result[0]?.content)).toBe(true);
    });

    it('should wrap context in user-context tags', () => {
      const messages: InternalMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      const result = prependUserContext(messages, 'Context here');
      const content = result[0]?.content;
      if (Array.isArray(content)) {
        const firstBlock = content[0];
        if (firstBlock?.type === 'text') {
          expect(firstBlock.text).toContain('<user-context>');
          expect(firstBlock.text).toContain('Context here');
          expect(firstBlock.text).toContain('</user-context>');
        }
      }
    });

    it('should not modify message if first message is not user', () => {
      const messages: InternalMessage[] = [
        { role: 'assistant', content: 'Hello' },
        { role: 'user', content: 'Hi' },
      ];
      const result = prependUserContext(messages, 'context');
      // Should not change the assistant message, but still prepend to first user
      // Actually, the function checks firstMessage.role === 'user', so it won't modify
      expect(result[0]?.role).toBe('assistant');
    });

    it('should prepend to content blocks', () => {
      const messages: InternalMessage[] = [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ];
      const result = prependUserContext(messages, 'Context');
      const content = result[0]?.content;
      if (Array.isArray(content)) {
        expect(content.length).toBeGreaterThan(1);
        expect(content[0]?.type).toBe('text');
      }
    });
  });
});
