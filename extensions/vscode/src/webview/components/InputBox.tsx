import { h } from 'preact';
import { useState, useCallback, useRef, useMemo } from 'preact/hooks';
import { CommandHint } from './CommandHint';

interface CommandDef {
  name: string;
  help: string;
}

interface InputBoxProps {
  onSubmit: (text: string) => void;
  onInterrupt: () => void;
  isBusy: boolean;
  commands?: CommandDef[];
}

export function InputBox({ onSubmit, onInterrupt, isBusy, commands }: InputBoxProps): h.JSX.Element {
  const [text, setText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [selIdx, setSelIdx] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Filter commands matching current input
  const commandMatches = useMemo(() => {
    if (!commands || !text.startsWith('/')) return [];
    const partial = text.slice(1).split(' ')[0]!.toLowerCase();
    if (!partial) return commands.slice(0, 12); // show all
    return commands.filter((c) => c.name.startsWith(partial));
  }, [commands, text]);

  // Exact match to a single command → hide hint
  const showHint = commandMatches.length > 0 &&
    !(commandMatches.length === 1 && commandMatches[0]!.name === text.slice(1).split(' ')[0]);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isBusy) return;
    onSubmit(trimmed);
    setText('');
    setSelIdx(0);
  }, [text, isBusy, onSubmit]);

  const handleCommandSelect = useCallback((name: string) => {
    setText('/' + name + ' ');
    setSelIdx(0);
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // ── Command hint keyboard handling ──────────
      if (text.startsWith('/') && commandMatches.length > 0) {
        if (e.key === 'Tab') {
          e.preventDefault();
          const idx = Math.min(selIdx, commandMatches.length - 1);
          handleCommandSelect(commandMatches[idx]!.name);
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelIdx((prev) => (prev + 1) % commandMatches.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelIdx((prev) => (prev - 1 + commandMatches.length) % commandMatches.length);
          return;
        }
        // Enter: partial → fill+submit; exact → submit
        if (e.key === 'Enter' && !e.shiftKey && !isBusy) {
          const exactMatch = commandMatches.length === 1 && commandMatches[0]!.name === text.slice(1).split(' ')[0];
          e.preventDefault();
          if (!exactMatch) {
            const idx = Math.min(selIdx, commandMatches.length - 1);
            const filled = '/' + commandMatches[idx]!.name + ' ';
            onSubmit(filled);
          } else {
            handleSubmit();
          }
          setText('');
          setSelIdx(0);
          return;
        }
      }

      // Ordinary Enter / Escape
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
    [text, isBusy, handleSubmit, onInterrupt, commandMatches, selIdx, handleCommandSelect],
  );

  // Reset selection when filter changes
  const prevMatchLen = useRef(0);
  if (commandMatches.length !== prevMatchLen.current) {
    prevMatchLen.current = commandMatches.length;
    if (selIdx >= commandMatches.length) setSelIdx(0);
  }

  // ── Drag & drop file paths from VS Code explorer ──────────────
  const insertAtCursor = useCallback((filePath: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const prefix = start > 0 && before[start - 1] !== ' ' && before[start - 1] !== '\n' ? ' ' : '';
    const newText = before + prefix + filePath + after;
    setText(newText);
    requestAnimationFrame(() => {
      const pos = start + prefix.length + filePath.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  }, [text]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
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
    const plainText = e.dataTransfer.getData('text/plain');
    if (plainText) {
      const paths = plainText.split('\n').map((p) => p.trim()).filter(Boolean);
      if (paths.length > 0) insertAtCursor(paths.join(' '));
    }
  }, [insertAtCursor]);

  return (
    <div
      class={`input-box ${dragOver ? 'input-dragover' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {showHint && (
        <CommandHint
          matches={commandMatches}
          selectedIndex={selIdx}
          onSelect={handleCommandSelect}
        />
      )}
      <div class="input-row">
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
    </div>
  );
}
