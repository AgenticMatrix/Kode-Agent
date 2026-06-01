/**
 * CoordinatorDashboard — TUI component for Coordinator mode status.
 *
 * Shows:
 * - Coordinator mode status (enabled / team / max workers)
 * - Active workers list from SubagentNode tree
 * - Quick summary of running / completed counts
 *
 * Used as an overlay panel launched via the TUI.
 */

import React from 'react'
import { Box, NoSelect, Text } from '@kode/tui'
import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'

import { $delegationState } from '../app/delegationStore.js'
import { $uiState } from '../app/uiStore.js'
import { useTurnSelector } from '../app/turnStore.js'
import { buildSubagentTree, treeTotals } from '../lib/subagentTree.js'
import type { Theme } from '../theme.js'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CoordinatorDashboardProps {
  /** Theme from UI state */
  t: Theme
  /** Callback to close the dashboard */
  onClose: () => void
}

// ---------------------------------------------------------------------------
// Worker Row
// ---------------------------------------------------------------------------

interface WorkerRowProps {
  agentId: string
  goal: string
  status: string
  apiCalls: number
  isActive: boolean
  t: Theme
}

function WorkerRow({ agentId, goal, status, apiCalls, isActive, t }: WorkerRowProps) {
  const statusColor =
    status === 'running'
      ? t.color.statusGood
      : status === 'completed'
        ? t.color.muted
        : status === 'error' || status === 'failed'
          ? t.color.error
          : t.color.muted

  const statusIcon =
    status === 'running'
      ? '▶'
      : status === 'completed'
        ? '✓'
        : status === 'error' || status === 'failed'
          ? '✗'
          : '○'

  return (
    <Box flexDirection="row">
      <Text color={statusColor} wrap="truncate-end">
        {'  '}
        {statusIcon}
        {' '}
      </Text>
      <Text color={isActive ? t.color.accent : t.color.muted} wrap="truncate-end">
        {agentId.slice(0, 8)}
      </Text>
      <Text color={t.color.muted} wrap="truncate-end">
        {'  '}
        {goal.slice(0, 40)}
        {goal.length > 40 ? '…' : ''}
      </Text>
      {apiCalls > 0 ? (
        <Text color={t.color.muted} wrap="truncate-end">
          {'  '}
          {apiCalls}
          {' calls'}
        </Text>
      ) : null}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function CoordinatorDashboard({ t, onClose }: CoordinatorDashboardProps) {
  const delegation = useStore($delegationState)
  const subagents = useTurnSelector((state) => state.subagents)
  const ui = useStore($uiState)
  const [, setNow] = useState(() => Date.now())

  // Periodic refresh for duration labels
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 2000)
    return () => clearInterval(id)
  }, [])

  const tree = useMemo(() => buildSubagentTree(subagents), [subagents])
  const totals = useMemo(() => treeTotals(tree), [tree])

  const coordinatorEnabled =
    process.env.KODE_COORDINATOR_MODE === 'true'
  const teamId = process.env.KODE_TEAM_ID ?? '(none)'
  const maxWorkers = process.env.KODE_MAX_WORKERS
    ? parseInt(process.env.KODE_MAX_WORKERS, 10)
    : 3

  const activeCount = totals.activeCount
  const totalCount = totals.descendantCount

  // Filter subagents using tree (SubagentNode[]) with item.status
  const runningAgents = tree.filter((node) => node.item.status === 'running')
  const completedAgents = tree.filter((node) => node.item.status === 'completed' || node.item.status === 'failed' || node.item.status === 'error')
  const completedCount = completedAgents.length
  const failedCount = tree.filter((node) => node.item.status === 'failed' || node.item.status === 'error').length

  return (
    <NoSelect flexDirection="column" paddingX={1}>
      <Box flexDirection="column" marginTop={1}>
        {/* Header */}
        <Box flexDirection="row" marginBottom={1}>
          <Text bold color={t.color.accent}>
            {'⚑ Coordinator Dashboard'}
          </Text>
          <Box flexGrow={1} />
          <Text color={t.color.muted}>
            Esc to close
          </Text>
        </Box>

        {/* Divider */}
        <Text color={t.color.border}>{'─'.repeat(40)}</Text>

        {/* Status Section */}
        <Box flexDirection="column" marginY={1}>
          <Text bold color={t.color.label}>
            Status
          </Text>
          <Box flexDirection="row">
            <Text color={t.color.muted}>  Mode: </Text>
            <Text color={coordinatorEnabled ? t.color.statusGood : t.color.muted}>
              {coordinatorEnabled ? 'Enabled' : 'Disabled'}
            </Text>
          </Box>
          <Box flexDirection="row">
            <Text color={t.color.muted}>  Team: </Text>
            <Text color={t.color.text}>{teamId}</Text>
          </Box>
          <Box flexDirection="row">
            <Text color={t.color.muted}>  Max workers: </Text>
            <Text color={t.color.text}>{maxWorkers}</Text>
          </Box>
          <Box flexDirection="row">
            <Text color={t.color.muted}>  Delegation: </Text>
            <Text color={delegation.paused ? t.color.error : t.color.statusGood}>
              {delegation.paused ? 'Paused' : 'Active'}
            </Text>
          </Box>
        </Box>

        {/* Worker Summary */}
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={t.color.label}>
            Workers
          </Text>
          <Box flexDirection="row">
            <Text color={t.color.statusGood}>  ▶ {activeCount} active</Text>
            <Text color={t.color.muted}>{'  ✓ '}{completedCount} completed</Text>
            {failedCount > 0 ? (
              <Text color={t.color.error}>{'  ✗ '}{failedCount} failed</Text>
            ) : null}
            <Text color={t.color.muted}>{'  Σ '}{totalCount} total</Text>
          </Box>
        </Box>

        {/* Active Workers List */}
        {runningAgents.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={t.color.muted}>Active workers:</Text>
            {runningAgents.slice(0, 10).map((node) => (
              <WorkerRow
                key={node.item.id}
                agentId={node.item.id}
                goal={node.item.goal}
                status={node.item.status}
                apiCalls={node.item.apiCalls ?? 0}
                isActive={node.item.status === 'running'}
                t={t}
              />
            ))}
            {runningAgents.length > 10 ? (
              <Text color={t.color.muted}>
                {'  ... and '}
                {runningAgents.length - 10}
                {' more'}
              </Text>
            ) : null}
          </Box>
        )}

        {/* Completed Workers (collapsed) */}
        {completedAgents.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={t.color.muted}>
              ✓ {completedAgents.length} completed worker(s) — check transcript for results
            </Text>
          </Box>
        )}

        {/* No Workers */}
        {totalCount === 0 && (
          <Box marginTop={1}>
            <Text color={t.color.muted}>
              No workers spawned yet. Use task delegation to create workers.
            </Text>
          </Box>
        )}

        {/* Divider */}
        <Text color={t.color.border}>{'─'.repeat(40)}</Text>

        {/* Quick Info */}
        <Box flexDirection="column" marginTop={1}>
          <Text color={t.color.muted}>
            Model: {ui.info?.model ?? 'unknown'}
          </Text>
          <Text color={t.color.muted}>
            Session: {ui.sid?.slice(0, 8) ?? 'none'}
          </Text>
        </Box>
      </Box>
    </NoSelect>
  )
}
