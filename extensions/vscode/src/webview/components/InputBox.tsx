import { h } from 'preact';
import { useState, useCallback, useRef } from 'preact/hooks';

interface InputBoxProps {
  onSubmit: (text: string) => void;
  onInterrupt: () => void;
  isBusy: boolean;
}

export function InputBox({ onSubmit, onInterrupt, isBusy }: InputBoxProps): h.JSX.Element {
  const [text, setText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isBusy) return;
    onSubmit(trimmed);
    setText('');
  }, [text, isBusy, onSubmit]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (isBusy) {
          onInterrupt();
        } else {
          handleSubmit();
        }
      }
      if (e.key === 'Escape' && isBusy) {
        e.preventDefault();
        onInterrupt();
      }
    },
    [handleSubmit, onInterrupt, isBusy],
  );

  // ── Drag & drop file paths from VS Code explorer ──────────────
  const insertAtCursor = useCallback((filePath: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = text.slice(0, start);
    const after = text.slice(end);
    // Add space before file path if not at start
    const prefix = start > 0 && before[start - 1] !== ' ' && before[start - 1] !== '\n' ? ' ' : '';
    const newText = before + prefix + filePath + after;
    setText(newText);
    // Restore cursor after inserted path
    requestAnimationFrame(() => {
      const pos = start + prefix.length + filePath.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  }, [text]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    if (!e.dataTransfer) return;

    // Try getting file path from text/plain (VS Code provides relative paths)
    const plainText = e.dataTransfer.getData('text/plain');
    if (plainText) {
      // Could be multiple files, one per line
      const paths = plainText.split('\n').map((p) => p.trim()).filter(Boolean);
      if (paths.length > 0) {
        insertAtCursor(paths.join(' '));
      }
    }
  }, [insertAtCursor]);

  return (
    <div
      class={`input-box ${dragOver ? 'input-dragover' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <textarea
        ref={textareaRef}
        class="input-textarea"
        value={text}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        onKeyDown={handleKeyDown}
        placeholder={
          dragOver
            ? 'Drop files here...'
            : isBusy
              ? 'Coder is thinking... (Esc to stop)'
              : 'Ask Coder anything... (Shift+Enter for newline, drag files to add paths)'
        }
        rows={3}
        disabled={isBusy}
      />
      {isBusy ? (
        <button class="stop-button" onClick={onInterrupt}>
          Stop
        </button>
      ) : (
        <button class="submit-button" onClick={handleSubmit} disabled={!text.trim()}>
          Send
        </button>
      )}
    </div>
  );
}
