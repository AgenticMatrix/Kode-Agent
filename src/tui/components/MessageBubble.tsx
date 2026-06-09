import { Box, Text } from 'ink';

import type {
  Message, TextBlock, ThinkingBlock, ToolUseBlock, ToolResultBlock,
  TodoUpdateBlock, TurnBoundary, SubagentBlock,
  CompactionBoundary, SpeculationBlock, CompletionBoundary,
} from '../../types.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import { getToolUseRenderer, getToolResultRenderer } from '../../tools/registry.js';
import { TodoUpdateBlockRenderer } from './blocks/TodoUpdateBlockRenderer.js';
import { TurnBoundaryRenderer } from './blocks/TurnBoundaryRenderer.js';
import { SubagentBlockRenderer } from './blocks/SubagentBlockRenderer.js';
import { CompactionBoundaryRenderer } from './blocks/CompactionBoundaryRenderer.js';
import { SpeculationBlockRenderer } from './blocks/SpeculationBlockRenderer.js';
import { CompletionBoundaryRenderer } from './blocks/CompletionBoundaryRenderer.js';

interface MessageBubbleProps {
  message: Message;
}

/** Extract display text from blocks (text blocks concatenated). */
function blocksText(blocks: Message['blocks']): string {
  return blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.content)
    .join('');
}

/** Extract thinking text from blocks. */
function blocksThinking(blocks: Message['blocks']): string | undefined {
  const tb = blocks.find((b): b is ThinkingBlock => b.type === 'thinking');
  return tb?.content;
}

/** Build a human-readable parameter summary from tool input. */
function buildParamSummary(input: Record<string, unknown>): string {
  // Try common parameter patterns
  const filePath = input.file_path as string | undefined;
  if (filePath) {
    const short = filePath.split('/').slice(-2).join('/');
    return short;
  }
  const command = input.command as string | undefined;
  if (command) {
    return command.length > 50 ? command.slice(0, 47) + '...' : command;
  }
  const pattern = input.pattern as string | undefined;
  if (pattern) return pattern;
  const url = input.url as string | undefined;
  if (url) {
    try {
      const u = new URL(url);
      return u.hostname + u.pathname.slice(0, 30);
    } catch {
      return url.length > 40 ? url.slice(0, 37) + '...' : url;
    }
  }
  // Fallback: first non-internal key-value
  const keys = Object.keys(input).filter(k => !k.startsWith('_'));
  if (keys.length > 0) {
    const v = String(input[keys[0]]);
    return v.length > 40 ? v.slice(0, 37) + '...' : v;
  }
  return '';
}

/**
 * Renders a single chat message with role-based styling.
 *
 * For assistant messages with ContentBlocks, renders blocks in order:
 *   thinking → text → tool_use → tool_result → ...
 *
 * Falls back to legacy `content` / `thinking` fields when blocks are empty.
 *
 * Tool blocks are rendered via the tool registry (getToolUseRenderer / getToolResultRenderer),
 * allowing per-tool specialised renderers to be swapped in.
 */
export function MessageBubble({ message }: MessageBubbleProps) {
  const { role } = message;

  // ── Determine content source ──────────────────────────────
  const hasBlocks = message.blocks && message.blocks.length > 0;
  const displayContent = hasBlocks ? blocksText(message.blocks) : message.content;
  const thinkingContent = hasBlocks
    ? (blocksThinking(message.blocks) ?? message.thinking)
    : message.thinking;

  // ── System ────────────────────────────────────────────────
  if (role === 'system') {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text dimColor>
          <Text color="grey">[System]</Text> {displayContent}
        </Text>
      </Box>
    );
  }

  // ── User ──────────────────────────────────────────────────

  // Tool-result-only user messages: display inline without "You:" prefix
  const isToolResultOnly =
    role === 'user' &&
    hasBlocks &&
    message.blocks.every((b) => b.type === 'tool_result');

  if (role === 'user' && !isToolResultOnly) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text>
          <Text color="cyan" bold>You:</Text>{' '}
          <Text color="white">{displayContent}</Text>
        </Text>
      </Box>
    );
  }

  // ── Block renderer dispatcher ───────────────────────────────
  // Defined before the role sections so it's accessible from both
  // tool-result-only user messages and the assistant section.
  const renderBlock = (block: Message['blocks'][number], idx: number) => {
    // ── Tool use ────────────────────────────────────────────
    if (block.type === 'tool_use') {
      const tu = block as ToolUseBlock;
      const Renderer = getToolUseRenderer(tu.toolName);
      return (
        <Renderer
          key={idx}
          toolName={tu.toolName}
          toolId={tu.toolId}
          input={tu.input}
          paramSummary={buildParamSummary(tu.input)}
          state={tu.state}
          riskLevel={tu.riskLevel}
          permissionState={tu.permissionState}
          duration={tu.duration}
          result={tu.result}
        />
      );
    }

    // ── Tool result ─────────────────────────────────────────
    if (block.type === 'tool_result') {
      const tr = block as ToolResultBlock;
      const ResultRenderer = getToolResultRenderer(tr.toolName);
      return (
        <ResultRenderer
          key={idx}
          content={tr.content}
          isError={tr.isError}
          truncated={tr.truncated}
          duration={tr.duration}
          toolName={tr.toolName}
          metadata={tr.metadata}
        />
      );
    }

    // ── Todo update ─────────────────────────────────────────
    if (block.type === 'todo_update') {
      const td = block as TodoUpdateBlock;
      return (
        <TodoUpdateBlockRenderer
          key={idx}
          todos={td.todos}
          oldTodos={td.oldTodos}
        />
      );
    }

    // ── Turn boundary ───────────────────────────────────────
    if (block.type === 'turn_boundary') {
      const tb = block as TurnBoundary;
      return (
        <TurnBoundaryRenderer
          key={idx}
          turnId={tb.turnId}
          summary={tb.summary}
        />
      );
    }

    // ── Sub-agent ───────────────────────────────────────────
    if (block.type === 'subagent') {
      const sa = block as SubagentBlock;
      return (
        <SubagentBlockRenderer
          key={idx}
          agentType={sa.agentType}
          agentName={sa.agentName}
          state={sa.state}
          messageCount={sa.messageCount}
        />
      );
    }

    // ── Compaction boundary ─────────────────────────────────
    if (block.type === 'compaction') {
      const cb = block as CompactionBoundary;
      return (
        <CompactionBoundaryRenderer
          key={idx}
          removedCount={cb.removedCount}
          reason={cb.reason}
        />
      );
    }

    // ── Speculation ─────────────────────────────────────────
    if (block.type === 'speculation') {
      const sp = block as SpeculationBlock;
      return (
        <SpeculationBlockRenderer
          key={idx}
          state={sp.state}
        />
      );
    }

    // ── Completion boundary ─────────────────────────────────
    if (block.type === 'completion') {
      const cp = block as CompletionBoundary;
      return (
        <CompletionBoundaryRenderer
          key={idx}
          stopReason={cp.stopReason}
        />
      );
    }

    return null;
  };

  // ── Tool result (system-generated user message) ─────────────
  // Rendered inline (no "You:" prefix, no AI: header) for
  // tool_result blocks that follow tool_use in the agent loop.
  if (isToolResultOnly) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box paddingLeft={3} flexDirection="column">
          {message.blocks.map((block, idx) => renderBlock(block, idx))}
        </Box>
      </Box>
    );
  }

  // ── Assistant ─────────────────────────────────────────────
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box marginBottom={0}>
        <Text>
          <Text color="green" bold>AI:</Text>
        </Text>
      </Box>
      <Box paddingLeft={3} flexDirection="column">
        {/* Render blocks in their natural order */}
        {hasBlocks
          ? message.blocks.map((block, idx) => {
              if (block.type === 'thinking') {
                const thinkingLines = block.content.split('\n');
                const tooLong = thinkingLines.length > 2;
                const collapsed = tooLong && !message.thinkingExpanded;
                const displayText = collapsed
                  ? thinkingLines.slice(0, 2).join('\n')
                  : block.content;

                return (
                  <Box key={idx} flexDirection="column" marginBottom={1}>
                    <Text dimColor color="grey">{'💭 Thinking:'}</Text>
                    <Box paddingLeft={2} flexDirection="column">
                      <Text dimColor color="grey">{displayText}</Text>
                      {collapsed ? (
                        <Text dimColor color="grey">{'... (Ctrl+E to expand)'}</Text>
                      ) : null}
                      {tooLong && message.thinkingExpanded ? (
                        <Text dimColor color="grey">{'(Ctrl+E to collapse)'}</Text>
                      ) : null}
                    </Box>
                  </Box>
                );
              }

              if (block.type === 'text') {
                return <MarkdownRenderer key={idx} content={block.content} />;
              }

              return renderBlock(block, idx);
            })
          : null}

        {/* Fallback: legacy string content when no blocks */}
        {!hasBlocks && displayContent ? (
          <MarkdownRenderer content={displayContent} />
        ) : null}
      </Box>
    </Box>
  );
}
