import { useState, useEffect, useRef } from 'react';
import { Box, Text, useStdout } from 'ink';

import { renderLatex } from './latex-to-unicode.js';
import { highlightCode } from './highlight.js';

// ─── Token types ───────────────────────────────────────────────────────────

type InlineToken =
  | { type: 'text'; content: string }
  | { type: 'bold'; content: string }
  | { type: 'italic'; content: string }
  | { type: 'code'; content: string }
  | { type: 'math'; content: string };

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; tokens: InlineToken[] }
  | { type: 'code_block'; language: string; code: string }
  | { type: 'math_block'; content: string }
  | { type: 'list_item'; tokens: InlineToken[] }
  | { type: 'horizontal_rule' }
  | { type: 'table'; headers: string[]; alignments: ('left' | 'center' | 'right')[]; rows: string[][] }
  | { type: 'blockquote'; lines: { level: number; tokens: InlineToken[] }[] };

// ─── Inline parser ─────────────────────────────────────────────────────────

/**
 * Parse a single line of text into inline tokens.
 * Handles: **bold**, *italic*, `code`, $math$, and plain text.
 */
function parseInline(line: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  // Ordered by precedence: code first, then math, then bold, then italic
  const regex =
    /(`[^`]+`)|(\$\$[^$]+\$\$)|(\$[^$]+\$)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|([^`$*]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    const [full] = match;

    if (match[1]) {
      // Inline code: `code`
      tokens.push({ type: 'code', content: full.slice(1, -1) });
    } else if (match[2]) {
      // Display math: $$math$$ (inline fallback)
      tokens.push({ type: 'math', content: full.slice(2, -2) });
    } else if (match[3]) {
      // Inline math: $math$
      tokens.push({ type: 'math', content: full.slice(1, -1) });
    } else if (match[4]) {
      // Bold: **text**
      tokens.push({ type: 'bold', content: full.slice(2, -2) });
    } else if (match[5]) {
      // Italic: *text*
      tokens.push({ type: 'italic', content: full.slice(1, -1) });
    } else if (match[6]) {
      // Plain text
      tokens.push({ type: 'text', content: full });
    }
  }

  return tokens;
}

/**
 * Try to parse a group of lines as a markdown table.
 * Returns a table block if the lines form a valid table, or null otherwise.
 *
 * Recognizes:
 *   | Header 1 | Header 2 |
 *   |----------|----------|
 *   | Cell 1   | Cell 2   |
 *
 * With optional alignment indicators: :--- (left), :---: (center), ---: (right)
 */
function detectAndParseTable(lines: string[]): Block | null {
  if (lines.length < 2) return null;

  // All lines in the group must contain a pipe to be considered a table
  if (!lines.every((l) => l.includes('|'))) return null;

  // Second line must be a separator row
  if (!isTableSeparator(lines[1])) return null;

  // Parse header
  const headers = splitTableCells(lines[0]);

  // Parse alignments from separator
  const alignments = parseTableAlignments(lines[1]);

  // Normalize column count
  const colCount = headers.length;

  // Parse data rows
  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i++) {
    const cells = splitTableCells(lines[i]);
    // Pad missing columns with empty strings, trim extra columns
    while (cells.length < colCount) cells.push('');
    rows.push(cells.slice(0, colCount));
  }

  return { type: 'table', headers, alignments, rows };
}

/** Check if a line is a table separator row (e.g. |---|---| or |:---:|) */
function isTableSeparator(line: string): boolean {
  const cells = splitTableCells(line);
  if (cells.length === 0) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

/** Parse alignment indicators from a separator row. */
function parseTableAlignments(line: string): ('left' | 'center' | 'right')[] {
  return splitTableCells(line).map((cell) => {
    const trimmed = cell.trim();
    const left = trimmed.startsWith(':');
    const right = trimmed.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

/** Split a table row into cell strings, stripping leading/trailing pipes and whitespace. */
function splitTableCells(line: string): string[] {
  let trimmed = line.trim();
  // Strip leading pipe
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  // Strip trailing pipe
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  // Split on remaining pipes
  return trimmed.split('|').map((c) => c.trim());
}

/** Get the visible display width of a string for terminal column alignment.
 *  Follows wcwidth conventions: CJK, emoji, fullwidth chars = 2, ASCII = 1. */
function displayWidth(str: string): number {
  let width = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0) ?? 0;
    // Zero-width characters — do not advance cursor
    if (
      (cp >= 0x0300 && cp <= 0x036F) ||  // Combining Diacritical Marks
      (cp >= 0x0483 && cp <= 0x0489) ||  // Cyrillic Combining
      (cp >= 0x0591 && cp <= 0x05BD) ||  // Hebrew Combining
      cp === 0x05BF ||
      (cp >= 0x05C1 && cp <= 0x05C2) ||
      (cp >= 0x05C4 && cp <= 0x05C5) ||
      cp === 0x05C7 ||
      cp === 0x0610 || cp === 0x061A ||
      (cp >= 0x064B && cp <= 0x065F) ||  // Arabic Combining
      cp === 0x0670 ||
      (cp >= 0x06D6 && cp <= 0x06DC) ||
      (cp >= 0x06DF && cp <= 0x06E4) ||
      (cp >= 0x06E7 && cp <= 0x06E8) ||
      (cp >= 0x06EA && cp <= 0x06ED) ||
      cp === 0x0711 ||
      (cp >= 0x0730 && cp <= 0x074A) ||
      (cp >= 0x07A6 && cp <= 0x07B0) ||
      (cp >= 0x0900 && cp <= 0x0902) ||  // Devanagari
      cp === 0x093A || cp === 0x093C ||
      (cp >= 0x0941 && cp <= 0x0948) ||
      cp === 0x094D ||
      (cp >= 0x0E31 && cp <= 0x0E3A) ||  // Thai
      (cp >= 0x0E47 && cp <= 0x0E4E) ||
      cp === 0x200B ||  // Zero Width Space
      cp === 0x200C ||  // Zero Width Non-Joiner
      cp === 0x200D ||  // Zero Width Joiner
      (cp >= 0x200E && cp <= 0x200F) ||  // LRM / RLM
      (cp >= 0x2028 && cp <= 0x202E) ||  // Line/Paragraph Separator, LRE/RLE/PDF/LRO/RLO
      cp === 0x2060 ||  // Word Joiner
      (cp >= 0xFE00 && cp <= 0xFE0F) ||  // Variation Selectors 1-16
      cp === 0xFEFF     // BOM / ZWNBSP
    ) continue;
    // Wide characters (terminal renders as 2 columns)
    if (
      (cp >= 0x1100 && cp <= 0x115F) ||  // Hangul Jamo
      (cp >= 0x231A && cp <= 0x23FF) ||  // Misc Technical (⌚⌛⏳⏰ etc.)
      (cp >= 0x2600 && cp <= 0x27BF) ||  // Misc Symbols, Dingbats (emoji ✅✔️❌⭐ etc.)
      (cp >= 0x2E80 && cp <= 0xA4CF) ||  // CJK Radicals → Yi
      cp === 0xA960 || cp === 0xA961 ||   // Hangul Jamo Extended
      cp === 0xA963 || cp === 0xA96C ||
      (cp >= 0xAC00 && cp <= 0xD7A3) ||  // Hangul Syllables
      (cp >= 0xF900 && cp <= 0xFAFF) ||  // CJK Compat
      (cp >= 0xFE10 && cp <= 0xFE19) ||  // Vertical Forms
      (cp >= 0xFE30 && cp <= 0xFE6F) ||  // CJK Compat Forms
      (cp >= 0xFF01 && cp <= 0xFF60) ||  // Fullwidth Latin
      (cp >= 0xFFE0 && cp <= 0xFFE6) ||  // Fullwidth Signs
      (cp >= 0x1F000 && cp <= 0x1F9FF) || // Emoji & Symbols range
      (cp >= 0x1FA00 && cp <= 0x1FAFF) || // Chess Symbols, etc.
      (cp >= 0x20000 && cp <= 0x2FFFD) || // CJK Ext B+
      (cp >= 0x30000 && cp <= 0x3FFFD)    // CJK Ext G+
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/** Pad a string to a target display width (right-pad for left-aligned). */
function padToWidth(str: string, targetWidth: number, align: 'left' | 'center' | 'right'): string {
  const dw = displayWidth(str);
  if (dw >= targetWidth) return str;
  const diff = targetWidth - dw;

  if (align === 'right') return ' '.repeat(diff) + str;
  if (align === 'center') {
    const leftPad = Math.floor(diff / 2);
    const rightPad = diff - leftPad;
    return ' '.repeat(leftPad) + str + ' '.repeat(rightPad);
  }
  return str + ' '.repeat(diff);
}
// ─── Block parser ──────────────────────────────────────────────────────────

/**
 * Split raw markdown text into blocks.
 *
 * Strategy:
 * 1. Split on ``` fences to extract code blocks
 * 2. Split remaining text on blank lines to get paragraphs
 * 3. Detect tables, headings, lists, math blocks within paragraphs
 * 4. Parse inline formatting
 */
function parseBlocks(raw: string): Block[] {
  if (!raw.trim()) return [];

  const blocks: Block[] = [];

  // Step 1: Split into segments alternating text / code
  const segments = splitByFences(raw, '```');
  let inCodeBlock = false;

  // Step 1b: Also handle $$ math blocks
  const allSegments: { type: 'text' | 'code' | 'math_block'; content: string; lang?: string }[] = [];

  for (const seg of segments) {
    if (inCodeBlock) {
      const newlineIdx = seg.indexOf('\n');
      const lang = newlineIdx > 0 ? seg.slice(0, newlineIdx).trim() : '';
      const code = newlineIdx > 0 ? seg.slice(newlineIdx + 1) : seg;
      allSegments.push({ type: 'code', content: code, lang });
      inCodeBlock = false;
    } else {
      // Split this text segment by $$ fences for math blocks
      const mathSegs = splitByFences(seg, '$$');
      let inMathBlock = false;
      for (const mseg of mathSegs) {
        if (inMathBlock) {
          allSegments.push({ type: 'math_block', content: mseg.trim() });
          inMathBlock = false;
        } else {
          allSegments.push({ type: 'text', content: mseg });
          inMathBlock = true;
        }
      }
      // Only toggle if we actually had a $$ fence
      if (mathSegs.length % 2 === 0) inMathBlock = !inMathBlock;
      inCodeBlock = true;
    }
  }

  // Step 2: Parse text segments into paragraphs/headings/lists
  for (const seg of allSegments) {
    if (seg.type === 'code') {
      blocks.push({ type: 'code_block', language: seg.lang ?? '', code: seg.content });
      continue;
    }
    if (seg.type === 'math_block') {
      blocks.push({ type: 'math_block', content: seg.content });
      continue;
    }

    // Split text by blank lines
    const paragraphs = seg.content.split(/\n{2,}/).filter((p) => p.trim());
    for (const para of paragraphs) {
      const lines = para.split('\n').filter((l) => l.trim());

      // Try to detect and parse a table first (2+ lines with pipes & separator)
      const tableBlock = detectAndParseTable(lines);
      if (tableBlock) {
        blocks.push(tableBlock);
        continue;
      }

      // Blockquote: lines starting with >
      if (lines.every((l) => /^>+\s/.test(l))) {
        blocks.push({
          type: 'blockquote',
          lines: lines.map((l) => {
            const match = l.match(/^(>+)\s?(.*)/);
            const level = match?.[1]?.length ?? 1;
            const content = match?.[2] ?? '';
            return { level, tokens: parseInline(content) };
          }),
        });
        continue;
      }

      for (const line of lines) {
        const trimmed = line.trim();

        // Horizontal rule: ---, ***, ___ (3+ of the same char, optional spaces)
        if (/^[-*_]{3,}\s*$/.test(trimmed)) {
          blocks.push({ type: 'horizontal_rule' });
          continue;
        }

        // Heading: #, ##, ###, etc.
        const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
        if (headingMatch) {
          blocks.push({
            type: 'heading',
            level: headingMatch[1].length,
            text: headingMatch[2],
          });
          continue;
        }

        // Unordered list: - item or * item
        const listMatch = trimmed.match(/^[-*]\s+(.+)/);
        if (listMatch) {
          blocks.push({
            type: 'list_item',
            tokens: parseInline(listMatch[1]),
          });
          continue;
        }

        // Regular paragraph line
        blocks.push({
          type: 'paragraph',
          tokens: parseInline(trimmed),
        });
      }
    }
  }

  return blocks;
}

/**
 * Split text by a fence delimiter (``` or $$).
 * Returns alternating [normal, fenced, normal, fenced, ...] segments.
 */
function splitByFences(text: string, fence: string): string[] {
  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const idx = remaining.indexOf(fence);
    if (idx === -1) {
      parts.push(remaining);
      break;
    }
    parts.push(remaining.slice(0, idx));
    remaining = remaining.slice(idx + fence.length);
    const nextIdx = remaining.indexOf(fence);
    if (nextIdx === -1) {
      // Unclosed fence — treat remainder as normal text
      parts.push(remaining);
      break;
    }
    parts.push(remaining.slice(0, nextIdx));
    remaining = remaining.slice(nextIdx + fence.length);
  }

  return parts;
}

// ─── Inline renderer ───────────────────────────────────────────────────────

/**
 * Render a single inline token as an Ink <Text> element.
 */
function InlineTokenElement({ token }: { token: InlineToken }) {
  const { type, content } = token;

  if (type === 'code') {
    return (
      <Text color="cyan">
        {content}
      </Text>
    );
  }

  if (type === 'math') {
    return (
      <Text italic color="cyan">
        {renderLatex(content)}
      </Text>
    );
  }

  if (type === 'bold') {
    return <Text bold>{content}</Text>;
  }

  if (type === 'italic') {
    return <Text italic>{content}</Text>;
  }

  return <Text>{content}</Text>;
}


/**
 * Render an array of inline tokens as a single line.
 */
function InlineLine({ tokens }: { tokens: InlineToken[] }) {
  return (
    <Text>
      {tokens.map((token, i) => (
        <InlineTokenElement key={i} token={token} />
      ))}
    </Text>
  );
}

// ─── Block renderer ────────────────────────────────────────────────────────

/**
 * Render a single block.
 */
function BlockElement({ block, termWidth }: { block: Block; termWidth: number }) {
  switch (block.type) {
    case 'heading':
      return (
        <Box marginY={block.level === 1 ? 1 : 0}>
          <Text bold>
            {block.text}
          </Text>
        </Box>
      );

    case 'paragraph':
      return (
        <Box>
          <InlineLine tokens={block.tokens} />
        </Box>
      );

    case 'code_block': {
      const highlighted = highlightCode(block.code, block.language);
      return (
        <Box
          flexDirection="column"
          marginY={1}
          paddingX={2}
          paddingY={1}
          borderStyle="single"
          borderColor="grey"
        >
          {block.language ? (
            <Text dimColor color="yellow">
              {block.language}
            </Text>
          ) : null}
          {highlighted.map((line, i) => (
            <Text key={i}>
              {line.tokens.map((t, j) => (
                <Text key={j} color={t.color}>
                  {t.text}
                </Text>
              ))}
            </Text>
          ))}
        </Box>
      );
    }

    case 'math_block': {
      // Render the entire block through LaTeX→Unicode, then split lines
      const rendered = renderLatex(block.content);
      const lines = rendered.split('\n');
      return (
        <Box
          marginY={1}
          paddingX={2}
          paddingY={1}
          borderStyle="round"
          borderColor="cyan"
          flexDirection="column"
        >
          {lines.map((line, i) => (
            <Text key={i} italic color="cyan">
              {line || ' '}
            </Text>
          ))}
        </Box>
      );
    }

    case 'list_item':
      return (
        <Box marginLeft={2}>
          <Text>
            <Text color="cyan">  • </Text>
            <InlineLine tokens={block.tokens} />
          </Text>
        </Box>
      );

    case 'horizontal_rule':
      return (
        <Box marginY={1}>
          <Text dimColor color="grey">
            {'─'.repeat(40)}
          </Text>
        </Box>
      );

    case 'table': {
      const { headers, alignments, rows } = block;
      const allRows = [headers, ...rows];
      const colCount = headers.length;

      // Calculate natural column widths based on max content width per column
      const naturalWidths: number[] = Array.from({ length: colCount }, (_, ci) =>
        Math.max(...allRows.map((r) => displayWidth(r[ci] || ''))),
      );

      const pad = 1;
      const naturalInnerWidths = naturalWidths.map((w) => w + pad * 2);
      const naturalTotal = naturalInnerWidths.reduce((a, b) => a + b, 0) + colCount + 1;

      const maxWidth = Math.max(20, termWidth);

      // Scale down if the table is wider than the terminal
      let colWidths = naturalWidths;
      if (naturalTotal > maxWidth) {
        const borderOverhead = colCount * 3 + 1;
        const available = maxWidth - borderOverhead;
        const totalNatural = naturalWidths.reduce((a, b) => a + b, 0);
        // Shrink min column width when there are too many columns to fit at 3
        const minColWidth = Math.min(3, Math.max(2, Math.floor(available / colCount)));
        colWidths = naturalWidths.map((w) =>
          Math.max(minColWidth, Math.floor((w / totalNatural) * available)),
        );
        // Correct overflow caused by Math.max clamping small columns up to minColWidth
        let allocated = colWidths.reduce((a, b) => a + b, 0);
        if (allocated > available) {
          const byWidth = colWidths
            .map((w, i) => ({ w, i }))
            .sort((a, b) => b.w - a.w);
          for (const item of byWidth) {
            if (allocated <= available) break;
            const reduce = Math.min(item.w - minColWidth, allocated - available);
            colWidths[item.i] -= reduce;
            allocated -= reduce;
          }
        }
      }

      const innerWidths = colWidths.map((w) => w + pad * 2);

      // Border helpers
      const topBorder = '┌' + innerWidths.map((w) => '─'.repeat(w)).join('┬') + '┐';
      const sepBorder = '├' + innerWidths.map((w) => '─'.repeat(w)).join('┼') + '┤';
      const botBorder = '└' + innerWidths.map((w) => '─'.repeat(w)).join('┴') + '┘';

      // Wrap cell text to fit a given display width
      const wrapCell = (text: string, width: number): string[] => {
        const lines: string[] = [];
        let cur = '';
        let curW = 0;
        for (const ch of text) {
          const chW = displayWidth(ch);
          if (curW + chW > width && cur.length > 0) {
            lines.push(cur);
            cur = ch;
            curW = chW;
          } else {
            cur += ch;
            curW += chW;
          }
        }
        if (cur.length > 0) lines.push(cur);
        return lines.length > 0 ? lines : [''];
      };

      // Render a row into an array of lines (multi-line if any cell wraps)
      const renderRowLines = (cells: string[]): string[][] => {
        const wrapped = cells.map((cell, ci) => wrapCell(cell, colWidths[ci]!));
        const maxLines = Math.max(...wrapped.map((w) => w.length), 1);
        const result: string[][] = [];
        for (let li = 0; li < maxLines; li++) {
          const lineCells = cells.map((_, ci) => {
            const line = wrapped[ci]?.[li] ?? '';
            return padToWidth(` ${line} `, innerWidths[ci]!, alignments[ci] || 'left');
          });
          result.push(lineCells);
        }
        return result;
      };

      const headerLines = renderRowLines(headers);
      const rowLines = rows.map((row) => renderRowLines(row));

      return (
        <Box flexDirection="column" marginY={1}>
          <Text color="grey">{topBorder}</Text>
          {headerLines.map((cells, li) => (
            <Text key={`h${li}`} bold color="white">
              {'│' + cells.join('│') + '│'}
            </Text>
          ))}
          <Text color="grey">{sepBorder}</Text>
          {rowLines.map((lines, ri) =>
            lines.map((cells, li) => (
              <Text key={`${ri}-${li}`} color="white">
                {'│' + cells.join('│') + '│'}
              </Text>
            )),
          )}
          <Text color="grey">{botBorder}</Text>
        </Box>
      );
    }

    case 'blockquote': {
      const quoteColors = ['grey', 'yellow', 'magenta'];
      return (
        <Box flexDirection="column" marginY={1}>
          {block.lines.map((ql, li) => {
            // Build prefix: "│ │ │ " for nesting level
            const prefix = Array.from({ length: ql.level }, (_, i) => (
              <Text key={i} color={quoteColors[Math.min(i, quoteColors.length - 1)]}>
                │{' '}
              </Text>
            ));
            return (
              <Box key={li}>
                <Text dimColor>{prefix}</Text>
                <InlineLine tokens={ql.tokens} />
              </Box>
            );
          })}
        </Box>
      );
    }

    default:
      return null;
  }
}

// ─── Public component ──────────────────────────────────────────────────────

interface MarkdownRendererProps {
  content: string;
}

/**
 * Render markdown text as Ink components.
 *
 * Supports:
 * - Headings (#, ##, ###)
 * - Bold (**text**) and italic (*text*)
 * - Inline code (`code`) with background
 * - Fenced code blocks (```lang ... ```) with border
 * - Inline math ($formula$) in cyan italic
 * - Display math blocks ($$...$$) with rounded border
 * - Unordered lists (- item or * item)
 * - Horizontal rules (---, ***, ___)
 * - Tables (| Header | ... | with alignment)
 * - Blockquotes (> text, with nesting support)
 * - Paragraphs
 */
export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const { stdout } = useStdout();
  const [termWidth, setTermWidth] = useState(
    () => stdout?.columns ?? process.stdout.columns ?? 80,
  );

  useEffect(() => {
    const cols = stdout?.columns;
    if (cols && cols !== termWidth) {
      setTermWidth(cols);
    }
  }, [stdout?.columns]);

  // Debounced re-render after content stops changing (streaming settles).
  // This ensures terminal dimensions are stable and Ink has finished layout.
  const [renderEpoch, setRenderEpoch] = useState(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      setRenderEpoch((e) => e + 1);
    }, 100);
    return () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, [content]);

  const blocks = parseBlocks(content);

  if (blocks.length === 0) {
    return null;
  }

  // Buffer for accumulated parent padding: App(paddingX=1) + ChatView(paddingX=1)
  // + MessageBubble(paddingLeft=3) + terminal right margin(1) ≈ 6, use 8 for safety.
  const maxOutputWidth = Math.max(20, termWidth - 8);

  return (
    <Box flexDirection="column" key={`md-${renderEpoch}`}>
      {blocks.map((block, i) => (
        <BlockElement key={i} block={block} termWidth={maxOutputWidth} />
      ))}
    </Box>
  );
}
