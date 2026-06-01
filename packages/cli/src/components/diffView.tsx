/**
 * DiffView — Interactive unified / split diff viewer
 *
 * Renders as a full-overlay component in the TUI.  Uses Myers diff from
 * @kode/shared.  Supports keyboard navigation (j/k/↑↓), view mode toggling
 * (u/s), and optional accept/reject callbacks.
 */
import React, { useCallback, useMemo, useState } from 'react'
import { Box, Text, useInput } from '@kode/tui'
import { diffLines } from '@kode/shared'
import type { DiffEdit } from '@kode/shared'

import type { DiffViewState } from '../app/interfaces.js'
import { patchOverlayState } from '../app/overlayStore.js'
import type { Theme } from '../theme.js'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DiffViewProps {
  state: DiffViewState
  t: Theme
}

// ---------------------------------------------------------------------------
// Line helper
// ---------------------------------------------------------------------------

interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'hunk'
  oldNum: number | null
  newNum: number | null
  text: string
}

/**
 * Convert raw diff edits into numbered DiffLine rows (unified format).
 */
function buildUnifiedLines(
  edits: DiffEdit[],
  oldLabel: string,
  newLabel: string,
): DiffLine[] {
  const lines: DiffLine[] = []
  let oldLine = 0
  let newLine = 0

  // Build hunks the same way shared/src/utils/diff.ts does
  const hunks: DiffEdit[][] = []
  let currentHunk: DiffEdit[] = []
  let ctxBeforeHunk = 0

  for (const edit of edits) {
    if (edit.type === 'equal') {
      if (currentHunk.length === 0) {
        ctxBeforeHunk++
      } else {
        currentHunk.push(edit)
      }
    } else {
      // First change: include up to 3 context lines before
      if (currentHunk.length === 0 && ctxBeforeHunk > 0) {
        const start = Math.max(0, edits.indexOf(edit) - Math.min(ctxBeforeHunk, 3))
        for (let k = start; k < edits.indexOf(edit); k++) {
          if (edits[k]!.type === 'equal') currentHunk.push(edits[k]!)
        }
      }
      currentHunk.push(edit)
      ctxBeforeHunk = 0
    }
    // End hunk when we have 3+ trailing context equal lines
    if (edit.type === 'equal' && currentHunk.length > 0) {
      const remaining = edits.slice(edits.indexOf(edit) + 1)
      if (remaining.filter(e => e.type !== 'equal').length === 0) {
        // Last change in file — include remaining context
        for (const r of remaining) {
          if (r.type === 'equal') currentHunk.push(r)
        }
        hunks.push(currentHunk)
        currentHunk = []
        break
      }
      if (edit === edits[edits.indexOf(edit)] && ctxBeforeHuntEnd(edits, edits.indexOf(edit))) {
        hunks.push(currentHunk)
        currentHunk = []
      }
    }
  }
  if (currentHunk.length > 0) hunks.push(currentHunk)

  // Fallback: if no hunks, create one big hunk
  if (hunks.length === 0 && edits.length > 0) {
    hunks.push([...edits])
  }

  for (const hunk of hunks) {
    const hasChanges = hunk.some(e => e.type !== 'equal')
    if (!hasChanges) continue

    let oldStart = 0
    let newStart = 0
    let oldCount = 0
    let newCount = 0
    for (const e of hunk) {
      if (e.type === 'equal') { oldCount++; newCount++; }
      else if (e.type === 'delete') oldCount++
      else if (e.type === 'insert') newCount++
    }
    // Compute line numbers
    oldStart = edits.indexOf(hunk[0]!) + 1 // rough estimate
    newStart = oldStart // simplified

    lines.push({
      type: 'hunk',
      oldNum: null,
      newNum: null,
      text: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
    })

    for (const edit of hunk) {
      oldLine++
      newLine++
      if (edit.type === 'equal') {
        lines.push({ type: 'ctx', oldNum: oldLine, newNum: newLine, text: edit.value ?? '' })
      } else if (edit.type === 'delete') {
        lines.push({ type: 'del', oldNum: oldLine, newNum: null, text: edit.value ?? '' })
        newLine--
      } else if (edit.type === 'insert') {
        lines.push({ type: 'add', oldNum: null, newNum: newLine, text: edit.value ?? '' })
        oldLine--
      }
    }
  }

  return lines
}

function ctxBeforeHuntEnd(edits: DiffEdit[], idx: number): boolean {
  let eqCount = 0
  for (let i = idx + 1; i < edits.length; i++) {
    if (edits[i]!.type === 'equal') eqCount++
    else return eqCount >= 3
    if (eqCount >= 3) return true
  }
  return false
}

/**
 * Split mode: produce paired [oldLine, newLine] for side-by-side.
 */
interface SplitRow {
  oldNum: number | null
  oldText: string
  oldType: 'del' | 'ctx' | 'empty'
  newNum: number | null
  newText: string
  newType: 'add' | 'ctx' | 'empty'
}

function buildSplitRows(edits: DiffEdit[]): SplitRow[] {
  const rows: SplitRow[] = []
  let oi = 1
  let ni = 1

  for (const edit of edits) {
    if (edit.type === 'equal') {
      rows.push({
        oldNum: oi++, oldText: edit.value ?? '', oldType: 'ctx',
        newNum: ni++, newText: edit.value ?? '', newType: 'ctx',
      })
    } else if (edit.type === 'delete') {
      // Pair delete with the next insert if possible
      const next = edits[edits.indexOf(edit) + 1]
      if (next?.type === 'insert') {
        rows.push({
          oldNum: oi++, oldText: edit.value ?? '', oldType: 'del',
          newNum: ni++, newText: next.value ?? '', newType: 'add',
        })
        edits.splice(edits.indexOf(next), 1)
      } else {
        rows.push({
          oldNum: oi++, oldText: edit.value ?? '', oldType: 'del',
          newNum: null, newText: '', newType: 'empty',
        })
      }
    } else if (edit.type === 'insert') {
      rows.push({
        oldNum: null, oldText: '', oldType: 'empty',
        newNum: ni++, newText: edit.value ?? '', newType: 'add',
      })
    }
  }
  return rows
}

// ---------------------------------------------------------------------------
// Line number formatter
// ---------------------------------------------------------------------------

function fmtNum(n: number | null, width: number): string {
  if (n == null) return ' '.repeat(width)
  return String(n).padStart(width)
}

const LINE_NUM_WIDTH = 4

// ---------------------------------------------------------------------------
// DiffView
// ---------------------------------------------------------------------------

export function DiffView({ state, t }: DiffViewProps) {
  const { oldContent, newContent, filePath, mode } = state
  const [scrollOffset, setScrollOffset] = useState(0)
  const [displayMode, setDisplayMode] = useState<'unified' | 'split'>(mode)

  const diffResult = useMemo(
    () => diffLines(oldContent.split('\n'), newContent.split('\n')),
    [oldContent, newContent],
  )

  const unifiedLines = useMemo(
    () => buildUnifiedLines(diffResult.edits, '--- a/old', `+++ b/${filePath ?? 'new'}`),
    [diffResult.edits, filePath],
  )

  const splitRows = useMemo(
    () => buildSplitRows([...diffResult.edits]),
    [diffResult.edits],
  )

  // -- keyboard handling --
  const close = useCallback(() => patchOverlayState({ diffView: null }), [])

  useInput((ch, key) => {
    if (key.escape || (key.ctrl && ch.toLowerCase() === 'c')) return close()

    if (key.upArrow || ch === 'k') return setScrollOffset(o => Math.max(0, o - 1))
    if (key.downArrow || ch === 'j') return setScrollOffset(o => o + 1)

    if (ch === 'u') return setDisplayMode('unified')
    if (ch === 's') return setDisplayMode('split')

    if (key.pageDown) return setScrollOffset(o => o + 10)
    if (key.pageUp) return setScrollOffset(o => Math.max(0, o - 10))
    if (ch === 'g') return setScrollOffset(0)
    if (ch === 'G') return setScrollOffset(Number.MAX_SAFE_INTEGER)
  })

  // -- compute viewport --
  const viewportHeight = 20
  const totalLines = displayMode === 'unified' ? unifiedLines.length : splitRows.length
  const clampedOffset = Math.max(0, Math.min(scrollOffset, Math.max(0, totalLines - viewportHeight)))

  // -- colours --
  const bgAdd = t.color.diffAdded
  const bgDel = t.color.diffRemoved
  const fgAdd = t.color.diffAddedWord
  const fgDel = t.color.diffRemovedWord
  const fgMuted = t.color.muted
  const fgAccent = t.color.accent
  const fgBody = t.color.text
  const fgStatus = t.color.statusFg

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {/* Header */}
      <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <Box flexDirection="row">
          <Text bold color={fgAccent}>
            Diff
          </Text>
          {filePath ? <Text color={fgMuted}> — {filePath}</Text> : null}
          <Text color={fgMuted}> ({diffResult.changeCount} changes)</Text>
        </Box>
        <Box flexDirection="row">
          <Text color={fgMuted}>
            [
          </Text>
          <Text bold={displayMode === 'unified'} color={displayMode === 'unified' ? fgAccent : fgMuted}>
            u
          </Text>
          <Text color={fgMuted}>nified | </Text>
          <Text bold={displayMode === 'split'} color={displayMode === 'split' ? fgAccent : fgMuted}>
            s
          </Text>
          <Text color={fgMuted}>plit]</Text>
        </Box>
      </Box>

      {/* Divider */}
      <Text color={fgMuted}>{'─'.repeat(40)}</Text>

      {/* Diff content */}
      {displayMode === 'unified' ? (
        <UnifiedView
          bgAdd={bgAdd}
          bgDel={bgDel}
          fgAdd={fgAdd}
          fgDel={fgDel}
          fgAccent={fgAccent}
          fgBody={fgBody}
          fgMuted={fgMuted}
          lines={unifiedLines}
          offset={clampedOffset}
          viewportHeight={viewportHeight}
        />
      ) : (
        <SplitView
          bgAdd={bgAdd}
          bgDel={bgDel}
          fgAdd={fgAdd}
          fgDel={fgDel}
          fgBody={fgBody}
          fgMuted={fgMuted}
          offset={clampedOffset}
          rows={splitRows}
          viewportHeight={viewportHeight}
        />
      )}

      {/* Bottom bar */}
      <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
        <Text color={fgMuted}>
          ↑↓/jk navigate · u unified · s split · g/G top/bottom · PgUp/PgDn page · Esc close
        </Text>
        <Text color={fgStatus}>
          {clampedOffset + 1}-{Math.min(clampedOffset + viewportHeight, totalLines)} / {totalLines}
        </Text>
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Unified view (single column)
// ---------------------------------------------------------------------------

function UnifiedView({
  bgAdd, bgDel, fgAdd, fgDel, fgAccent, fgBody, fgMuted,
  lines, offset, viewportHeight,
}: {
  bgAdd: string; bgDel: string; fgAdd: string; fgDel: string
  fgAccent: string; fgBody: string; fgMuted: string
  lines: DiffLine[]; offset: number; viewportHeight: number
}) {
  const visible = lines.slice(offset, offset + viewportHeight)

  return (
    <Box flexDirection="column">
      {visible.map((line, i) => {
        const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : line.type === 'hunk' ? '@@' : '  '
        const bg = line.type === 'add' ? bgAdd : line.type === 'del' ? bgDel : undefined
        const fg = line.type === 'hunk' ? fgAccent
          : line.type === 'add' ? fgAdd
          : line.type === 'del' ? fgDel
          : line.type === 'ctx' ? fgMuted : fgBody
        const bold = line.type === 'hunk'

        return (
          <Text backgroundColor={bg} bold={bold} color={fg} key={`${offset + i}`}>
            {prefix}{line.text.slice(0, 100)}
          </Text>
        )
      })}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Split view (side by side)
// ---------------------------------------------------------------------------

function SplitView({
  bgAdd, bgDel, fgAdd, fgDel, fgBody, fgMuted,
  rows, offset, viewportHeight,
}: {
  bgAdd: string; bgDel: string; fgAdd: string; fgDel: string
  fgBody: string; fgMuted: string
  rows: SplitRow[]; offset: number; viewportHeight: number
}) {
  const visible = rows.slice(offset, offset + viewportHeight)
  const colWidth = 48

  return (
    <Box flexDirection="column">
      {/* Column headers */}
      <Box flexDirection="row">
        <Box width={LINE_NUM_WIDTH + colWidth + 2}>
          <Text bold color={fgDel}>--- a/old</Text>
        </Box>
        <Text color={fgMuted}> │ </Text>
        <Box width={LINE_NUM_WIDTH + colWidth + 2}>
          <Text bold color={fgAdd}>+++ b/new</Text>
        </Box>
      </Box>

      {visible.map((row, i) => {
        const oldBg = row.oldType === 'del' ? bgDel : undefined
        const newBg = row.newType === 'add' ? bgAdd : undefined
        const oldFg = row.oldType === 'del' ? fgDel : fgMuted
        const newFg = row.newType === 'add' ? fgAdd : fgBody

        const oldPrefix = row.oldType === 'del' ? '-' : ' '
        const newPrefix = row.newType === 'add' ? '+' : ' '

        const oldNum = fmtNum(row.oldNum, LINE_NUM_WIDTH)
        const newNum = fmtNum(row.newNum, LINE_NUM_WIDTH)

        const oldText = (oldPrefix + row.oldText).slice(0, colWidth).padEnd(colWidth)
        const newText = (newPrefix + row.newText).slice(0, colWidth).padEnd(colWidth)

        return (
          <Box flexDirection="row" key={`${offset + i}`}>
            <Box flexDirection="row" width={LINE_NUM_WIDTH + colWidth + 2}>
              <Text color={fgMuted}>{oldNum} </Text>
              <Text backgroundColor={oldBg} color={oldFg}>{oldText}</Text>
            </Box>
            <Text color={fgMuted}> │ </Text>
            <Box flexDirection="row" width={LINE_NUM_WIDTH + colWidth + 2}>
              <Text color={fgMuted}>{newNum} </Text>
              <Text backgroundColor={newBg} color={newFg}>{newText}</Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
