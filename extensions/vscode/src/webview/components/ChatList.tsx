/**
 * ChatList.tsx — Scrollable message list with tool execution cards
 */

import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { MarkdownRenderer } from './MarkdownRenderer';
import type { ChatMessage, ToolState } from '../app';

interface ChatListProps {
  messages: ChatMessage[];
  streamingText: string;
  tools: ToolState[];
  onFileClick: (path: string) => void;
}

export function ChatList({ messages, streamingText, tools, onFileClick }: ChatListProps): h.JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, tools]);

  const activeTools = tools.filter((t) => t.status === 'running');
  const completedTools = tools.filter((t) => t.status !== 'running');

  return (
    <div class="chat-list">
      {messages.map((msg) => (
        <div key={msg.id} class={`message message-${msg.role}`}>
          <span class="message-role">
            {msg.role === 'user' ? 'You' : msg.role === 'system' ? 'System' : 'Coder'}
          </span>
          <div class="message-text"><MarkdownRenderer text={msg.text} onFileClick={onFileClick} /></div>
        </div>
      ))}

      {/* Active tool indicators */}
      {activeTools.map((tool) => (
        <div key={tool.toolId} class="tool-card tool-running">
          <span class="tool-spinner" />
          <span class="tool-name">Running {tool.name}...</span>
        </div>
      ))}

      {/* Completed tool indicators */}
      {completedTools.map((tool) => (
        <div
          key={tool.toolId}
          class={`tool-card ${tool.status === 'error' ? 'tool-error' : 'tool-completed'}`}
        >
          <span class="tool-icon">{tool.status === 'error' ? '✗' : '✓'}</span>
          <span class="tool-name">
            {tool.name} {tool.status === 'error' ? `— ${tool.error}` : ''}
          </span>
        </div>
      ))}

      {streamingText && (
        <div class="message message-assistant streaming">
          <span class="message-role">Coder</span>
          <div class="message-text"><MarkdownRenderer text={streamingText} onFileClick={onFileClick} /></div>
          <span class="cursor">|</span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
