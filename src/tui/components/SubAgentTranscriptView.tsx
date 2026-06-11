import React from 'react';
import { Box, Text } from 'ink';
import { getSubAgentRegistry } from '../../subagents/agent-spawn/registry-ref.js';
import type { ContentBlock } from '../../core/types.js';

const AGENT_ICONS: Record<string, string> = {
  explore: '🔍',
  plan: '📋',
  'general-purpose': '🔧',
};

interface SubAgentTranscriptViewProps {
  agentId: string;
  onBack: () => void;
}

export function SubAgentTranscriptView({ agentId, onBack }: SubAgentTranscriptViewProps) {
  const registry = getSubAgentRegistry();
  const agent = registry?.get(agentId);

  if (!agent) {
    return React.createElement(
      Box,
      { flexDirection: 'column', padding: 1 },
      React.createElement(Text, { color: 'red' }, `Sub-agent not found: ${agentId}`),
      React.createElement(Text, { dimColor: true }, 'Press Esc to go back'),
    );
  }

  const icon = AGENT_ICONS[agent.agentType] ?? '🤖';
  const transcript = agent.transcript ?? [];

  // Render a single transcript message
  const renderMessage = (msg: { role: string; content: string | ContentBlock[] }, i: number) => {
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    const roleLabel = msg.role === 'assistant' ? 'AI' : msg.role === 'user' ? 'User' : 'System';
    const roleColor = msg.role === 'assistant' ? 'green' : msg.role === 'user' ? 'cyan' : 'grey';

    return React.createElement(
      Box,
      { key: i, flexDirection: 'column', marginBottom: 1 },
      React.createElement(
        Text,
        { bold: true, color: roleColor },
        `${roleLabel}:`,
      ),
      ...blocks.map((block, j) => {
        if (block.type === 'text' && block.text) {
          const text = block.text.slice(0, 300);
          return React.createElement(
            Box,
            { key: j, paddingLeft: 2 },
            React.createElement(Text, { color: 'white' }, text + (block.text.length > 300 ? '...' : '')),
          );
        }
        if (block.type === 'tool_use') {
          const toolName = block.name ?? 'tool';
          return React.createElement(
            Box,
            { key: j, paddingLeft: 2 },
            React.createElement(Text, { dimColor: true, color: 'yellow' }, `  ⚙ ${toolName}`),
          );
        }
        if (block.type === 'tool_result') {
          const content = typeof block.content === 'string' ? block.content : '';
          const summary = content.slice(0, 80);
          return React.createElement(
            Box,
            { key: j, paddingLeft: 2 },
            React.createElement(Text, { dimColor: true }, `  ↓ ${summary}${content.length > 80 ? '...' : ''}`),
          );
        }
        if (block.type === 'thinking' && block.thinking) {
          const thinking = block.thinking.slice(0, 120);
          return React.createElement(
            Box,
            { key: j, paddingLeft: 2 },
            React.createElement(Text, { dimColor: true, color: 'grey' }, `  💭 ${thinking}${block.thinking.length > 120 ? '...' : ''}`),
          );
        }
        return null;
      }),
      blocks.length === 0 && typeof msg.content === 'string' && msg.content
        ? React.createElement(
            Box,
            { paddingLeft: 2 },
            React.createElement(Text, { color: 'white' }, msg.content.slice(0, 300)),
          )
        : null,
    );
  };

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: 'blue',
      paddingX: 1,
      width: '90%',
    },
    // Header
    React.createElement(
      Box,
      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1 },
      React.createElement(
        Text,
        { bold: true, color: 'cyan' },
        `${icon} ${agent.agentType} (${agent.id}) — ${agent.turnCount} turns, ${agent.toolCount} tools`,
      ),
      React.createElement(Text, { dimColor: true }, 'Esc to go back'),
    ),
    // Prompt
    React.createElement(
      Box,
      { marginBottom: 1 },
      React.createElement(Text, { dimColor: true }, `Prompt: ${agent.prompt.slice(0, 120)}${agent.prompt.length > 120 ? '...' : ''}`),
    ),
    // Divider
    React.createElement(
      Box,
      { marginBottom: 1 },
      React.createElement(Text, { dimColor: true }, '─'.repeat(40)),
    ),
    // Transcript messages
    ...transcript.map((msg, i) => renderMessage(msg, i)),
    // Empty state
    transcript.length === 0 && React.createElement(Text, { dimColor: true }, '(no transcript available)'),
  );
}
