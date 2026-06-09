import { Box, Text } from 'ink';
import type { SpeculationState } from '../../../types.js';

export interface SpeculationBlockRendererProps {
  state: SpeculationState;
}

const CONFIG: Record<SpeculationState, { icon: string; color: string; label: string }> = {
  predicting: { icon: '🔮', color: 'grey', label: 'Predicting...' },
  used: { icon: '✅', color: 'green', label: 'Speculation used' },
  discarded: { icon: '❌', color: 'grey', label: 'Speculation discarded' },
};

/**
 * Renders a speculation execution block (OCC feature).
 *
 * 🔮 Predicting...
 * ✅ Speculation used
 * ❌ Speculation discarded (strikethrough via dimColor)
 */
export function SpeculationBlockRenderer({ state }: SpeculationBlockRendererProps) {
  const { icon, color, label } = CONFIG[state];

  return (
    <Box flexDirection="row" marginBottom={1} paddingLeft={1}>
      <Text
        dimColor={state === 'discarded'}
        color={color}
        strikethrough={state === 'discarded'}
      >
        {icon} {label}
      </Text>
    </Box>
  );
}
