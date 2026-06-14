import { Box, Text } from 'ink';
import { listCommandNames, findSlashCommand } from '../../commands/index.js';

interface CommandHintProps {
  inputText: string;
  selectedIndex: number;
}

export function CommandHint({ inputText, selectedIndex }: CommandHintProps) {
  if (!inputText.startsWith('/')) return null;

  const inputName = inputText.slice(1).split(' ')[0]!.toLowerCase();
  const allCommands = listCommandNames();

  // Find the shortest prefix that yields the cycle group (>1 match)
  let cycleGroup: string[] = [];
  for (let len = inputName.length; len >= 1; len--) {
    const prefix = inputName.slice(0, len);
    const m = allCommands.filter((c) => c.startsWith(prefix));
    if (m.length > 1) {
      cycleGroup = m;
      break;
    }
  }

  // Exact match filter for "no matching commands" check
  const exactMatches = allCommands.filter((c) => c.startsWith(inputName));
  if (exactMatches.length === 0) {
    return (
      <Box>
        <Text dimColor>No matching commands</Text>
      </Box>
    );
  }

  // Exact match to a single command — hide hint
  if (exactMatches.length === 1 && exactMatches[0] === inputName) return null;

  // Use cycleGroup if available, otherwise exactMatches
  const displayGroup = cycleGroup.length > 0 ? cycleGroup : exactMatches;
  const selIdx = Math.min(
    Math.max(selectedIndex, 0),
    displayGroup.length - 1,
  );

  return (
    <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1}>
      <Text dimColor>Commands</Text>
      {displayGroup.map((cmd, i) => {
        const isSelected = i === selIdx;
        const help = findSlashCommand(cmd)?.help ?? '';
        return (
          <Text key={cmd}>
            <Text
              bold={isSelected}
              color={isSelected ? 'cyan' : undefined}
              dimColor={!isSelected}
            >
              {isSelected ? '> ' : '  '}/{cmd}
            </Text>
            <Text dimColor> — {help}</Text>
          </Text>
        );
      })}
      <Text dimColor>↑↓ select · Tab / Enter fill</Text>
    </Box>
  );
}
