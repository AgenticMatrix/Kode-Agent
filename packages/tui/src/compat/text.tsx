/**
 * Text compat wrapper — Phase 0
 *
 * Wraps ink v7 Text to accept CA-specific props (dim, wrap-trim mode)
 * that were added to the old vendored ink Text.
 * Phase 0: extra props are silently stripped or mapped.
 */
import { Text as InkText } from 'ink';
import type { TextProps as InkTextProps } from 'ink';
import type { FC } from 'react';

// Extended wrap type: ink v7 doesn't support 'wrap-trim' or 'end', but CA
// components use them. We accept them and map to the closest ink-supported value.
type ExtendedWrap = InkTextProps['wrap'] | 'wrap-trim' | 'end' | 'middle';

export interface TextProps extends Omit<InkTextProps, 'wrap'> {
  /** CA extension: dimmed/bright color (Phase 0 — passed through) */
  dim?: boolean;
  /** CA extension: dimColor flag — same as dim */
  dimColor?: boolean;
  /** CA extension: bold flag */
  bold?: boolean;
  /** CA extension: italic flag */
  italic?: boolean;
  /** CA extension: strikethrough flag */
  strikethrough?: boolean;
  /** CA extension: underline flag */
  underline?: boolean;
  /** Extended wrap: adds 'wrap-trim' (mapped to 'wrap') and 'end' (mapped to 'truncate-end') */
  wrap?: ExtendedWrap;
}

/** Map CA-specific wrap modes to ink v7 supported values */
function normalizeWrap(wrap: ExtendedWrap | undefined): InkTextProps['wrap'] {
  if (wrap === 'wrap-trim') return 'wrap';
  if (wrap === 'end') return 'truncate-end';
  if (wrap === 'middle') return 'truncate-middle';
  return wrap;
}

/**
 * Text component — wraps ink v7 Text, maps/strips CA-specific style props.
 */
const Text: FC<TextProps> = ({ dim, dimColor, bold, italic, strikethrough, underline, color, wrap, ...props }) => {
  // Phase 0: map dim to ink's dimColor prop. Other styles are already in InkTextProps.
  const isDim = dim || dimColor;
  return (
    <InkText
      dimColor={isDim}
      bold={bold}
      italic={italic}
      strikethrough={strikethrough}
      underline={underline}
      color={color}
      wrap={normalizeWrap(wrap)}
      {...props}
    />
  );
};

export default Text;
