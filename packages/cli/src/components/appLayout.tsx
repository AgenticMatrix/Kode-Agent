import React from 'react'
import { Box, MainScreen, NoSelect, Static, Text } from '@coder/tui'
import { useStore } from '@nanostores/react'
import { memo, useMemo, useRef } from 'react'

import { useGateway } from '../app/gatewayContext.js'
import type { AppLayoutProps } from '../app/interfaces.js'
import { $isBlocked, $overlayState, patchOverlayState } from '../app/overlayStore.js'
import { $uiState } from '../app/uiStore.js'
import { SHOW_FPS } from '../config/env.js'
import { PLACEHOLDER } from '../content/placeholders.js'
import {
  COMPOSER_PROMPT_GAP_WIDTH,
  composerPromptWidth,
  inputVisualHeight,
  stableComposerColumns
} from '../lib/inputMetrics.js'
import { PerfPane } from '../lib/perfPane.js'
import { composerPromptText } from '../lib/prompt.js'

import { AgentsOverlay } from './agentsOverlay.js'
import { GoodVibesHeart, StatusRule } from './appChrome.js'
import { CoordinatorDashboard } from './coordinatorDashboard.js'
import { FileTree } from './fileTree.js'
import { FloatingOverlays, PromptZone } from './appOverlays.js'
import { Panel, SessionPanel } from './branding.js'
import { FpsOverlay } from './fpsOverlay.js'
import { HelpHint } from './helpHint.js'
import { MessageLine } from './messageLine.js'
import { SlashCommandPopup } from './slashCommandPopup.js'
import { QueuedMessages } from './queuedMessages.js'
import { LiveTodoPanel, StreamingAssistant } from './streamingAssistant.js'
import { TextInput, type TextInputMouseApi } from './textInput.js'

const PromptPrefix = memo(function PromptPrefix({
  bold = false,
  color,
  promptText,
  width
}: {
  bold?: boolean
  color: string
  promptText: string
  width: number
}) {
  const glyphWidth = Math.max(1, width - COMPOSER_PROMPT_GAP_WIDTH)

  return (
    <Box width={width}>
      <Box width={glyphWidth}>
        <Text bold={bold} color={color}>
          {promptText}
        </Text>
      </Box>
      <Box width={COMPOSER_PROMPT_GAP_WIDTH} />
    </Box>
  )
})

const TranscriptPaneStatic = memo(function TranscriptPaneStatic({
  composer,
  transcript
}: Pick<AppLayoutProps, 'composer' | 'transcript'>) {
  const ui = useStore($uiState)

  const lastUserIdx = useMemo(() => {
    const items = transcript.historyItems

    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].role === 'user') {
        return i
      }
    }

    return -1
  }, [transcript.historyItems])

  const firstUserIdx = useMemo(
    () => transcript.historyItems.findIndex(m => m.role === 'user'),
    [transcript.historyItems]
  )

  const staticItems = useMemo(
    () =>
      transcript.historyItems.map((msg, index) => ({
        key: `history-${index}-c${composer.cols}`,
        jsx: (
          <Box flexDirection="column" key={`history-${index}`}>
            {msg.role === 'user' && firstUserIdx >= 0 && index > firstUserIdx && (
              <Box marginTop={1}>
                <Text color={ui.theme.color.border}>───</Text>
              </Box>
            )}

            {msg.kind === 'intro' ? (
              <Box flexDirection="column" paddingTop={1}>
                {msg.info && (
                  <SessionPanel
                    info={msg.info}
                    maxWidth={Math.max(1, composer.cols - 2)}
                    sid={ui.sid}
                    t={ui.theme}
                  />
                )}
              </Box>
            ) : msg.kind === 'panel' && msg.panelData ? (
              <Panel sections={msg.panelData.sections} t={ui.theme} title={msg.panelData.title} />
            ) : (
              <MessageLine
                cols={composer.cols}
                compact={ui.compact}
                detailsMode={ui.detailsMode}
                detailsModeCommandOverride={ui.detailsModeCommandOverride}
                msg={msg}
                sections={ui.sections}
                t={ui.theme}
              />
            )}
          </Box>
        ),
      })),
    [
      transcript.historyItems,
      composer.cols,
      firstUserIdx,
      ui.compact,
      ui.detailsMode,
      ui.detailsModeCommandOverride,
      ui.sections,
      ui.sid,
      ui.theme,
    ]
  )

  return <Static items={staticItems}>{(item: { jsx: React.ReactNode }) => item.jsx}</Static>
})

const TranscriptPaneDynamic = memo(function TranscriptPaneDynamic({
  actions,
  composer,
  progress,
  transcript
}: Pick<AppLayoutProps, 'actions' | 'composer' | 'progress' | 'transcript'>) {
  const ui = useStore($uiState)

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <LiveTodoPanel />

      <StreamingAssistant
        cols={composer.cols}
        compact={ui.compact}
        detailsMode={ui.detailsMode}
        detailsModeCommandOverride={ui.detailsModeCommandOverride}
        progress={progress}
        sections={ui.sections}
      />
    </Box>
  )
})

const ComposerPane = memo(function ComposerPane({
  actions,
  composer,
  status
}: Pick<AppLayoutProps, 'actions' | 'composer' | 'status'>) {
  const ui = useStore($uiState)
  const isBlocked = useStore($isBlocked)
  const sh = (composer.inputBuf[0] ?? composer.input).startsWith('!')
  const promptText = composerPromptText(ui.theme.brand.prompt, ui.info?.profile_name, sh, false, composer.cols)
  const promptWidth = composerPromptWidth(promptText)
  const promptBlank = ' '.repeat(promptWidth)
  const inputColumns = stableComposerColumns(composer.cols, promptWidth, false)
  const inputHeight = inputVisualHeight(composer.input, inputColumns)
  const inputMouseRef = useRef<null | TextInputMouseApi>(null)

  const captureInputDrag = (e: GutterMouseEvent) => {
    if (e.button !== 0) {
      return
    }

    e.stopImmediatePropagation?.()
    inputMouseRef.current?.startAtBeginning()
  }

  const dragFromPromptRow = (e: GutterMouseEvent) => {
    if (e.button !== 0) {
      return
    }

    e.stopImmediatePropagation?.()
    inputMouseRef.current?.dragAt(e.localRow ?? 0, (e.localCol ?? 0) - promptWidth)
  }

  const dragFromSpacer = (e: GutterMouseEvent) => {
    if (e.button !== 0) {
      return
    }

    e.stopImmediatePropagation?.()
    inputMouseRef.current?.dragAt(0, (e.localCol ?? 0) - promptWidth)
  }

  const endInputDrag = () => inputMouseRef.current?.end()

  return (
    <NoSelect
      flexDirection="column"
      flexShrink={0}
      fromLeftEdge
      onClick={(e: { cellIsBlank?: boolean }) => {
        if (e.cellIsBlank) {
          actions.clearSelection()
        }
      }}
      paddingX={1}
    >
      <QueuedMessages
        cols={composer.cols}
        queued={composer.queuedDisplay}
        queueEditIdx={composer.queueEditIdx}
        t={ui.theme}
      />

      {ui.bgTasks.size > 0 && (
        <Text color={ui.theme.color.muted}>
          {ui.bgTasks.size} background {ui.bgTasks.size === 1 ? 'task' : 'tasks'} running
        </Text>
      )}

      {status.showStickyPrompt ? (
        <Text color={ui.theme.color.muted} wrap="truncate-end">
          <Text color={ui.theme.color.label}>↳ </Text>

          {status.stickyPrompt}
        </Text>
      ) : (
        <Box height={1} onMouseDown={captureInputDrag} onMouseDrag={dragFromSpacer} onMouseUp={endInputDrag} />
      )}

      <StatusRulePane at="top" composer={composer} status={status} />

      <Box flexDirection="column" marginTop={ui.statusBar === 'top' ? 0 : 1} position="relative">
        <FloatingOverlays
          cols={composer.cols}
          compIdx={composer.compIdx}
          completions={composer.completions}
          onActiveSessionSelect={actions.activateLiveSession}
          onActiveSessionClose={actions.closeLiveSession}
          onModelSelect={actions.onModelSelect}
          onNewLiveSession={actions.newLiveSession}
          onNewPromptSession={actions.newPromptSession}
          onPickerSelect={actions.resumeById}
          pagerPageSize={composer.pagerPageSize}
        />

        {composer.input === '?' && !composer.inputBuf.length && <HelpHint t={ui.theme} />}

        {!isBlocked && (
          <>
            {composer.inputBuf.map((line, i) => (
              <Box key={i}>
                <Box width={promptWidth}>
                  {i === 0 ? (
                    <PromptPrefix color={ui.theme.color.muted} promptText={promptText} width={promptWidth} />
                  ) : (
                    <Text color={ui.theme.color.muted}>{promptBlank}</Text>
                  )}
                </Box>

                <Text color={ui.theme.color.text}>{line || ' '}</Text>
              </Box>
            ))}

            <Box
              onMouseDown={captureInputDrag}
              onMouseDrag={dragFromPromptRow}
              onMouseUp={endInputDrag}
              position="relative"
              width={Math.max(1, composer.cols - 2)}
            >
              <Box width={promptWidth}>
                {sh ? (
                  <PromptPrefix color={ui.theme.color.shellDollar} promptText={promptText} width={promptWidth} />
                ) : composer.inputBuf.length ? (
                  <Text color={ui.theme.color.prompt}>{promptBlank}</Text>
                ) : (
                  <PromptPrefix bold color={ui.theme.color.prompt} promptText={promptText} width={promptWidth} />
                )}
              </Box>

              <Box flexGrow={0} flexShrink={0} height={inputHeight} width={inputColumns}>
                <TextInput
                  columns={inputColumns}
                  mouseApiRef={inputMouseRef}
                  onChange={composer.updateInput}
                  onPaste={composer.handleTextPaste}
                  onSubmit={composer.submit}
                  placeholder={composer.empty ? PLACEHOLDER : ui.busy ? 'Ctrl+C to interrupt…' : ''}
                  value={composer.input}
                  voiceRecordKey={composer.voiceRecordKey}
                />
              </Box>

              <Box position="absolute" right={0}>
                <GoodVibesHeart t={ui.theme} tick={status.goodVibesTick} />
              </Box>
            </Box>
          </>
        )}
      </Box>

      {!composer.empty && !ui.sid && <Text color={ui.theme.color.muted}>⚕ {ui.status}</Text>}

      <StatusRulePane at="bottom" composer={composer} status={status} />
    </NoSelect>
  )
})

const AgentsOverlayPane = memo(function AgentsOverlayPane() {
  const { gw } = useGateway()
  const ui = useStore($uiState)
  const overlay = useStore($overlayState)

  return (
    <AgentsOverlay
      gw={gw}
      initialHistoryIndex={overlay.agentsInitialHistoryIndex}
      onClose={() => patchOverlayState({ agents: false, agentsInitialHistoryIndex: 0 })}
      t={ui.theme}
    />
  )
})

const CoordinatorDashboardPane = memo(function CoordinatorDashboardPane() {
  const ui = useStore($uiState)

  return (
    <CoordinatorDashboard
      onClose={() => patchOverlayState({ coordinatorDashboard: false })}
      t={ui.theme}
    />
  )
})

const FILETREE_AUTO_HIDE_COLS = 100;

const FileTreePane = memo(function FileTreePane({
  cwd,
}: {
  cwd: string;
}) {
  const ui = useStore($uiState);
  const overlay = useStore($overlayState);

  if (!overlay.fileTreeVisible) return null;

  return (
    <Box borderRight borderStyle="single" flexShrink={0} paddingRight={1} width={30}>
      <PerfPane id="filetree">
        <FileTree rootPath={cwd} t={ui.theme} maxWidth={28} />
      </PerfPane>
    </Box>
  );
});

const StatusRulePane = memo(function StatusRulePane({
  at,
  composer,
  status
}: Pick<AppLayoutProps, 'composer' | 'status'> & { at: 'bottom' | 'top' }) {
  const ui = useStore($uiState)

  if (ui.statusBar !== at) {
    return null
  }

  const modeLabel =
    process.env.CODER_COORDINATOR_MODE === 'true'
      ? 'COORDINATOR'
      : process.env.CODER_WORKER_MODE === 'true'
        ? 'WORKER'
        : undefined

  return (
    <Box marginTop={at === 'top' ? 1 : 0}>
      <StatusRule
        bgCount={ui.bgTasks.size}
        busy={ui.busy}
        cols={composer.cols}
        cwdLabel={status.cwdLabel}
        liveSessionCount={ui.liveSessionCount}
        model={ui.info?.model ?? ''}
        modelFast={ui.info?.fast || ui.info?.service_tier === 'priority'}
        modelReasoningEffort={ui.info?.reasoning_effort}
        modeLabel={modeLabel}
        onModeLabelClick={
          modeLabel === 'COORDINATOR'
            ? () => patchOverlayState({ coordinatorDashboard: true })
            : undefined
        }
        onSessionCountClick={() => patchOverlayState({ sessions: true })}
        sessionStartedAt={status.sessionStartedAt}
        showCost={ui.showCost}
        status={ui.status}
        statusColor={status.statusColor}
        t={ui.theme}
        turnStartedAt={status.turnStartedAt}
        usage={ui.usage}
        voiceLabel={status.voiceLabel}
      />
    </Box>
  )
})

export const AppLayout = memo(function AppLayout({
  actions,
  composer,
  mouseTracking,
  progress,
  status,
  transcript
}: AppLayoutProps) {
  const overlay = useStore($overlayState)
  const ui = useStore($uiState)

  return (
    <MainScreen mouseTracking={mouseTracking}>
      <TranscriptPaneStatic composer={composer} transcript={transcript} />

      <Box flexDirection="column">
        <Box flexDirection="row">
          {overlay.agents ? (
            <PerfPane id="agents">
              <AgentsOverlayPane />
            </PerfPane>
          ) : overlay.coordinatorDashboard ? (
            <PerfPane id="coordinator">
              <CoordinatorDashboardPane />
            </PerfPane>
          ) : (
            <>
              {composer.cols >= FILETREE_AUTO_HIDE_COLS && <FileTreePane cwd={process.cwd()} />}
              <PerfPane id="transcript">
                <TranscriptPaneDynamic
                  actions={actions}
                  composer={composer}
                  progress={progress}
                  transcript={transcript}
                />
              </PerfPane>
            </>
          )}
        </Box>

        {!overlay.agents && !overlay.coordinatorDashboard && (
          <>
            <PerfPane id="prompt">
              <PromptZone
                cols={composer.cols}
                onApprovalChoice={actions.answerApproval}
                onClarifyAnswer={actions.answerClarify}
                onSecretSubmit={actions.answerSecret}
                onSudoSubmit={actions.answerSudo}
              />
            </PerfPane>

            <SlashCommandPopup />

            <PerfPane id="composer">
              <ComposerPane actions={actions} composer={composer} status={status} />
            </PerfPane>

            {SHOW_FPS && (
              <Box flexShrink={0} justifyContent="flex-end" paddingRight={1}>
                <FpsOverlay t={ui.theme} />
              </Box>
            )}
          </>
        )}
      </Box>
    </MainScreen>
  )
})

type GutterMouseEvent = {
  button: number
  localCol?: number
  localRow?: number
  stopImmediatePropagation?: () => void
}
