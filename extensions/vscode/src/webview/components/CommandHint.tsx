import { h } from 'preact';

interface CommandDef {
  name: string;
  help: string;
}

interface CommandHintProps {
  matches: CommandDef[];
  selectedIndex: number;
  /** Called when user clicks a command. */
  onSelect: (name: string) => void;
}

export function CommandHint({ matches, selectedIndex, onSelect }: CommandHintProps): h.JSX.Element | null {
  if (matches.length === 0) return null;

  return (
    <div class="command-hint">
      {matches.map((cmd, i) => {
        const isSelected = i === selectedIndex;
        return (
          <div
            key={cmd.name}
            class={`command-hint-item ${isSelected ? 'command-hint-item--selected' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault(); // prevent blur from textarea
              onSelect(cmd.name);
            }}
          >
            <span class="command-hint-name">/{cmd.name}</span>
            <span class="command-hint-help"> — {cmd.help}</span>
          </div>
        );
      })}
      <div class="command-hint-footer">↑↓ select · Tab / Enter fill</div>
    </div>
  );
}
