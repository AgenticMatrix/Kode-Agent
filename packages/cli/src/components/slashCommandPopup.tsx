/**
 * slashCommandPopup.tsx — Slash Command Suggestion Popup
 *
 * Renders a compact dropdown above the composer when the user types "/"
 * as the first character.  Shows matching slash commands with arrow-key
 * navigation, Enter to execute, and Escape to dismiss.
 */
import React, { useMemo } from 'react'
import { Box, Text, useStdout } from '@kode/tui'
import { useStore } from '@nanostores/react'

import type { SlashCommand } from '../app/slash/types.js'
import { SLASH_COMMANDS } from '../app/slash/registry.js'
import { $uiState } from '../app/uiStore.js'

const MAX_VISIBLE = 10

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Filter SLASH_COMMANDS by prefix, matching against name and aliases.
 * Deduplicates — a command whose alias also matches is only shown once.
 */
function filterCommands(prefix: string): SlashCommand[] {
  if (!prefix) return [...SLASH_COMMANDS]
  const lower = prefix.toLowerCase()
  const seen = new Set<string>()
  const results: SlashCommand[] = []
  for (const cmd of SLASH_COMMANDS) {
    if (seen.has(cmd.name)) continue
    const nameMatch = cmd.name.startsWith(lower)
    const aliasMatch = (cmd.aliases ?? []).some((a) => a.toLowerCase().startsWith(lower))
    if (nameMatch || aliasMatch) {
      seen.add(cmd.name)
      results.push(cmd)
    }
  }
  // Sort: exact name matches first, then prefix matches, then alias matches
  return results.sort((a, b) => {
    const aExact = a.name === lower
    const bExact = b.name === lower
    if (aExact !== bExact) return aExact ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

// ---------------------------------------------------------------------------
// SlashCommandPopup
// ---------------------------------------------------------------------------

export function SlashCommandPopup() {
  const uiState = useStore($uiState)
  const { stdout } = useStdout()

  const { slashCommandOpen, slashCommandFilter, slashCommandSelectedIndex } = uiState
  const t = uiState.theme

  // ── Filter commands by prefix ─────────────────────────────────────
  const filtered = useMemo<SlashCommand[]>(() => {
    if (!slashCommandOpen) return []
    return filterCommands(slashCommandFilter)
  }, [slashCommandOpen, slashCommandFilter])

  // ── Visibility check ──────────────────────────────────────────────
  if (!slashCommandOpen) return null
  if (filtered.length === 0 && slashCommandFilter !== '') return null

  // ── Compute visible window ────────────────────────────────────────
  const visibleCount = Math.min(filtered.length, MAX_VISIBLE)
  const selIdx = Math.max(0, Math.min(slashCommandSelectedIndex, filtered.length - 1))
  const scrollOffset = Math.max(
    0,
    Math.min(selIdx - Math.floor(visibleCount / 2), filtered.length - visibleCount),
  )
  const visibleCmds = filtered.slice(scrollOffset, scrollOffset + visibleCount)

  const popupWidth = Math.min(80, (stdout?.columns ?? 80) - 4)

  return (
    <Box flexDirection="column" paddingX={1} marginBottom={0}>
      <Text color={t.color.muted}>{'─'.repeat(popupWidth)}</Text>

      {visibleCmds.map((cmd, vi) => {
        const globalIdx = scrollOffset + vi
        const isSelected = globalIdx === slashCommandSelectedIndex

        // Build display: aliases shown in muted after name
        const aliasHint = cmd.aliases?.length
          ? ` (${cmd.aliases.slice(0, 2).join(', ')})`
          : ''
        const usageHint = cmd.usage ? ` ${cmd.usage}` : ''
        const desc = cmd.help ?? ''

        return (
          <Box key={`cmd-${cmd.name}`} flexDirection="row">
            <Text color={isSelected ? t.color.accent : t.color.text}>
              {isSelected ? '▶ ' : '  '}/{cmd.name}
            </Text>
            {!!usageHint && (
              <Text color={isSelected ? t.color.accent : t.color.muted}>
                {usageHint}
              </Text>
            )}
            {!!aliasHint && (
              <Text color={t.color.muted}>{aliasHint}</Text>
            )}
            {!!desc && (
              <Text color={t.color.muted}>
                {' — '}{desc}
              </Text>
            )}
          </Box>
        )
      })}

      {/* Footer hint */}
      <Text color={t.color.muted}>
        ↑↓ navigate · Enter execute · Esc close · type to filter
      </Text>
      <Text color={t.color.muted}>{'─'.repeat(popupWidth)}</Text>
    </Box>
  )
}
