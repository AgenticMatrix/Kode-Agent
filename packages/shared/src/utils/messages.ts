/**
 * Message normalization utilities for LLM API calls.
 */

export interface InternalMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | MessageContentBlock[];
  metadata?: Record<string, unknown>;
}

export interface MessageContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | MessageContentBlock[];
  is_error?: boolean;
  source?: { type: 'base64'; media_type: string; data: string };
}

export interface ApiMessage {
  role: 'user' | 'assistant';
  content: string | ApiContentBlock[];
}

export type ApiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export function validateMessageSequence(messages: InternalMessage[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (messages.length === 0) return { valid: true, errors };
  if (messages[0]?.role !== 'user') {
    errors.push(`First message must have role "user", got "${messages[0]?.role}"`);
  }
  for (let i = 1; i < messages.length; i++) {
    if (messages[i]?.role === messages[i - 1]?.role) {
      errors.push(
        `Consecutive messages at indices ${i - 1} and ${i} have the same role "${messages[i]?.role}"`,
      );
    }
  }
  return { valid: errors.length === 0, errors };
}

function normalizeContent(
  content: string | MessageContentBlock[],
  maxToolResultTokens: number,
  truncationSuffix: string,
): string | ApiContentBlock[] {
  if (typeof content === 'string') return content;
  return content
    .map((block) => normalizeBlock(block, maxToolResultTokens, truncationSuffix))
    .filter((block): block is ApiContentBlock => block !== null);
}

function normalizeBlock(
  block: MessageContentBlock,
  maxToolResultTokens: number,
  truncationSuffix: string,
): ApiContentBlock | null {
  switch (block.type) {
    case 'text':
      if (!block.text) return null;
      return { type: 'text', text: block.text };
    case 'tool_use':
      if (!block.id || !block.name) return null;
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input ?? {} };
    case 'tool_result': {
      if (!block.tool_use_id) return null;
      let content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
      if (maxToolResultTokens > 0 && content.length > maxToolResultTokens * 4) {
        const maxChars = maxToolResultTokens * 4;
        if (content.length > maxChars) {
          content = content.slice(0, maxChars - truncationSuffix.length) + truncationSuffix;
        }
      }
      return { type: 'tool_result', tool_use_id: block.tool_use_id, content, is_error: block.is_error ?? false };
    }
    case 'image':
      if (!block.source) return null;
      return { type: 'image', source: { type: 'base64', media_type: block.source.media_type, data: block.source.data } };
    default:
      return null;
  }
}

export function normalizeMessagesForApi(
  messages: InternalMessage[],
  options: { maxToolResultTokens?: number; truncationSuffix?: string } = {},
): ApiMessage[] {
  const { maxToolResultTokens = 0, truncationSuffix = '...' } = options;
  const apiMessages: ApiMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    const content = normalizeContent(msg.content, maxToolResultTokens, truncationSuffix);
    apiMessages.push({ role: msg.role, content });
  }
  return mergeConsecutiveMessages(apiMessages);
}

function mergeContent(
  a: string | ApiContentBlock[],
  b: string | ApiContentBlock[],
): string | ApiContentBlock[] {
  if (typeof a === 'string' && typeof b === 'string') return a + '\n' + b;
  const aBlocks: ApiContentBlock[] = typeof a === 'string' ? [{ type: 'text', text: a }] : a;
  const bBlocks: ApiContentBlock[] = typeof b === 'string' ? [{ type: 'text', text: b }] : b;
  const hasToolResults = aBlocks.some((blk) => blk.type === 'tool_result');
  if (hasToolResults) return [...aBlocks, ...bBlocks];
  const merged: ApiContentBlock[] = [];
  for (const block of [...aBlocks, ...bBlocks]) {
    const last = merged[merged.length - 1];
    if (last?.type === 'text' && block.type === 'text') {
      last.text += '\n' + block.text;
    } else {
      merged.push(block);
    }
  }
  return merged;
}

export function mergeConsecutiveMessages(messages: ApiMessage[]): ApiMessage[] {
  if (messages.length <= 1) return messages;
  const merged: ApiMessage[] = [];
  let current = messages[0]!;
  for (let i = 1; i < messages.length; i++) {
    const next = messages[i]!;
    if (current.role === next.role) {
      current = { role: current.role, content: mergeContent(current.content, next.content) };
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  return merged;
}

export function validateToolResultPairing(messages: ApiMessage[]): {
  valid: boolean;
  unmatchedToolUses: string[];
  orphanedToolResults: string[];
} {
  const pendingToolUses = new Set<string>();
  const resolvedToolUses = new Set<string>();
  const orphanedToolResults: string[] = [];
  for (const msg of messages) {
    if (typeof msg.content === 'string') continue;
    for (const block of msg.content) {
      if (block.type === 'tool_use') {
        pendingToolUses.add(block.id);
      } else if (block.type === 'tool_result') {
        if (pendingToolUses.has(block.tool_use_id)) {
          pendingToolUses.delete(block.tool_use_id);
          resolvedToolUses.add(block.tool_use_id);
        } else if (!resolvedToolUses.has(block.tool_use_id)) {
          orphanedToolResults.push(block.tool_use_id);
        }
      }
    }
  }
  return {
    valid: pendingToolUses.size === 0 && orphanedToolResults.length === 0,
    unmatchedToolUses: Array.from(pendingToolUses),
    orphanedToolResults,
  };
}

export function prependUserContext(
  messages: InternalMessage[],
  userContext: string,
): InternalMessage[] {
  if (!userContext || messages.length === 0) return messages;
  const result = [...messages];
  const firstMessage = result[0];
  if (firstMessage && firstMessage.role === 'user') {
    const contextBlock: MessageContentBlock = {
      type: 'text',
      text: `<user-context>\n${userContext}\n</user-context>`,
    };
    if (typeof firstMessage.content === 'string') {
      firstMessage.content = [contextBlock, { type: 'text', text: firstMessage.content }];
    } else {
      firstMessage.content = [contextBlock, ...firstMessage.content];
    }
  }
  return result;
}
