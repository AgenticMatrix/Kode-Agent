import React from 'react'
import { Box, Text, useInput, useStdout } from '@coder/tui'
import { useEffect, useMemo, useState } from 'react'

import { providerDisplayNames } from '../domain/providers.js'
import { TUI_SESSION_MODEL_FLAG } from '../domain/slash.js'
import type { IGatewayClient } from '../gateway/client.js'
import type { ModelOptionProvider, ModelOptionsResponse } from '../gateway/types.js'
import { asRpcResult, rpcErrorMessage } from '../lib/rpc.js'
import type { Theme } from '../theme.js'

import { OverlayHint, useOverlayKeys, windowItems } from './overlayControls.js'

const VISIBLE = 12
const MIN_WIDTH = 40
const MAX_WIDTH = 90

type Stage = 'provider' | 'key' | 'model' | 'disconnect' | 'custom_provider' | 'custom_model' | 'remove_provider' | 'remove_model'

export function ModelPicker({ allowPersistGlobal = true, gw, onCancel, onSelect, sessionId, t }: ModelPickerProps) {
  const [providers, setProviders] = useState<ModelOptionProvider[]>([])
  const [currentModel, setCurrentModel] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [persistGlobal, setPersistGlobal] = useState(false)
  const [providerIdx, setProviderIdx] = useState(0)
  const [modelIdx, setModelIdx] = useState(0)
  const [stage, setStage] = useState<Stage>('provider')
  const [keyInput, setKeyInput] = useState('')
  const [keySaving, setKeySaving] = useState(false)
  const [keyError, setKeyError] = useState('')
  const [customProviderSlug, setCustomProviderSlug] = useState('')
  const [customProviderUrl, setCustomProviderUrl] = useState('')
  const [customProviderKey, setCustomProviderKey] = useState('')
  const [customProviderProxy, setCustomProviderProxy] = useState('')
  const [customProviderField, setCustomProviderField] = useState(0)
  const [customSaving, setCustomSaving] = useState(false)
  const [customError, setCustomError] = useState('')
  const [customModelName, setCustomModelName] = useState('')
  const [customModelSaving, setCustomModelSaving] = useState(false)
  const [customModelError, setCustomModelError] = useState('')
  const [lastProviderIdx, setLastProviderIdx] = useState(0)
  const [lastModelIdx, setLastModelIdx] = useState(0)
  const [removeSaving, setRemoveSaving] = useState(false)
  const [removeError, setRemoveError] = useState('')

  const { stdout } = useStdout()
  // Pin the picker to a stable width so the FloatBox parent (which shrinks-
  // to-fit with alignSelf="flex-start") doesn't resize as long provider /
  // model names scroll into view, and so `wrap="truncate-end"` on each row
  // has an actual constraint to truncate against.
  const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, (stdout?.columns ?? 80) - 6))

  useEffect(() => {
    gw.request<ModelOptionsResponse>('model.options', sessionId ? { session_id: sessionId } : {})
      .then(raw => {
        const r = asRpcResult<ModelOptionsResponse>(raw)

        if (!r) {
          setErr('invalid response: model.options')
          setLoading(false)

          return
        }

        const next = r.providers ?? []
        setProviders(next)
        setCurrentModel(String(r.model ?? ''))
        setProviderIdx(
          Math.max(
            0,
            next.findIndex(p => p.is_current)
          )
        )
        setModelIdx(0)
        setStage('provider')
        setErr('')
        setLoading(false)
      })
      .catch((e: unknown) => {
        setErr(rpcErrorMessage(e))
        setLoading(false)
      })
  }, [gw, sessionId])

  const provider = providers[providerIdx]
  const models = provider?.models ?? []
  const names = useMemo(() => providerDisplayNames(providers), [providers])

  const back = () => {
    if (stage === 'model' || stage === 'key' || stage === 'disconnect' || stage === 'custom_provider' || stage === 'custom_model' || stage === 'remove_provider' || stage === 'remove_model') {
      setStage('provider')
      setModelIdx(0)
      setKeyInput('')
      setKeyError('')
      setKeySaving(false)

      return
    }

    onCancel()
  }

  useOverlayKeys({ onBack: back, onClose: onCancel })

  useInput((ch, key) => {
    // Key entry stage handles its own input
    if (stage === 'key') {
      if (keySaving) {
        return
      }

      if (key.return) {
        if (!keyInput.trim()) {
          return
        }

        setKeySaving(true)
        setKeyError('')
        gw.request<{ provider?: ModelOptionProvider }>('model.save_key', {
          slug: provider?.slug,
          api_key: keyInput.trim(),
          ...(sessionId ? { session_id: sessionId } : {})
        })
          .then(raw => {
            const r = asRpcResult<{ provider?: ModelOptionProvider }>(raw)

            if (!r?.provider) {
              setKeyError('failed to save key')
              setKeySaving(false)

              return
            }

            // Update the provider in our list with fresh data
            setProviders(prev => prev.map(p => (p.slug === r.provider!.slug ? r.provider! : p)))
            setKeyInput('')
            setKeySaving(false)
            setStage('model')
            setModelIdx(0)
          })
          .catch((e: unknown) => {
            setKeyError(rpcErrorMessage(e))
            setKeySaving(false)
          })

        return
      }

      if (key.backspace || key.delete) {
        setKeyInput(v => v.slice(0, -1))

        return
      }

      // ctrl+u clears input
      if (ch === '\u0015') {
        setKeyInput('')

        return
      }

      if (ch && !key.ctrl && !key.meta) {
        setKeyInput(v => v + ch)
      }

      return
    }

    // Custom provider creation stage
    if (stage === 'custom_provider') {
      if (customSaving) {
        return
      }

      if (key.return) {
        if (customProviderField < 3) {
          setCustomProviderField(f => f + 1)
        } else {
          // Save on last field
          const slug = customProviderSlug.trim()
          if (!slug) {
            return
          }

          setCustomSaving(true)
          setCustomError('')
          gw.request<{ provider?: ModelOptionProvider }>('model.add_custom_provider', {
            slug,
            name: slug,
            base_url: customProviderUrl.trim() || undefined,
            api_key: customProviderKey.trim() || undefined,
            proxy: customProviderProxy.trim() || null,
            ...(sessionId ? { session_id: sessionId } : {})
          })
            .then(raw => {
              const r = asRpcResult<{ provider?: ModelOptionProvider }>(raw)

              if (!r?.provider) {
                setCustomError('failed to add provider')
                setCustomSaving(false)

                return
              }

              setProviders(prev => [...prev, r.provider!])
              setCustomProviderSlug('')
              setCustomProviderUrl('')
              setCustomProviderKey('')
              setCustomProviderProxy('')
              setCustomProviderField(0)
              setCustomSaving(false)
              setProviderIdx(providers.length)
              setStage('model')
              setModelIdx(0)
            })
            .catch((e: unknown) => {
              setCustomError(rpcErrorMessage(e))
              setCustomSaving(false)
            })
        }

        return
      }

      if (key.backspace || key.delete) {
        const setters = [setCustomProviderSlug, setCustomProviderUrl, setCustomProviderKey, setCustomProviderProxy]
        setters[customProviderField](v => v.slice(0, -1))

        return
      }

      if (ch === '') {
        const setters = [setCustomProviderSlug, setCustomProviderUrl, setCustomProviderKey, setCustomProviderProxy]
        setters[customProviderField]('')

        return
      }

      if (ch && !key.ctrl && !key.meta) {
        const setters = [setCustomProviderSlug, setCustomProviderUrl, setCustomProviderKey, setCustomProviderProxy]
        setters[customProviderField](v => v + ch)
      }

      return
    }

    // Custom model name stage
    if (stage === 'custom_model') {
      if (customModelSaving) {
        return
      }

      if (key.return) {
        const model = customModelName.trim()
        if (!model) {
          return
        }

        setCustomModelSaving(true)
        setCustomModelError('')
        gw.request<{ provider?: ModelOptionProvider }>('model.add_custom_model', {
          slug: provider?.slug,
          model,
          ...(sessionId ? { session_id: sessionId } : {})
        })
          .then(raw => {
            const r = asRpcResult<{ provider?: ModelOptionProvider }>(raw)

            if (!r?.provider) {
              setCustomModelError('failed to add model')
              setCustomModelSaving(false)

              return
            }

            setProviders(prev => prev.map(p => (p.slug === r.provider!.slug ? r.provider! : p)))
            setCustomModelName('')
            setCustomModelSaving(false)
            onSelect(
              `${model} --provider ${provider!.slug}${allowPersistGlobal && persistGlobal ? ' --global' : ` ${TUI_SESSION_MODEL_FLAG}`}`
            )
          })
          .catch((e: unknown) => {
            setCustomModelError(rpcErrorMessage(e))
            setCustomModelSaving(false)
          })

        return
      }

      if (key.backspace || key.delete) {
        setCustomModelName(v => v.slice(0, -1))

        return
      }

      if (ch === '') {
        setCustomModelName('')

        return
      }

      if (ch && !key.ctrl && !key.meta) {
        setCustomModelName(v => v + ch)
      }

      return
    }

    // Disconnect confirmation stage
    if (stage === 'disconnect') {
      if (ch.toLowerCase() === 'y' || key.return) {
        if (!provider) {
          setStage('provider')

          return
        }

        setKeySaving(true)
        gw.request<{ disconnected?: boolean }>('model.disconnect', {
          slug: provider.slug,
          ...(sessionId ? { session_id: sessionId } : {})
        })
          .then(raw => {
            const r = asRpcResult<{ disconnected?: boolean }>(raw)

            if (r?.disconnected) {
              // Mark provider as unauthenticated in local state
              setProviders(prev =>
                prev.map(p =>
                  p.slug === provider.slug
                    ? {
                        ...p,
                        authenticated: false,
                        models: [],
                        total_models: 0,
                        warning: p.key_env ? `paste ${p.key_env} to activate` : 'run `coder model` to configure'
                      }
                    : p
                )
              )
            }

            setKeySaving(false)
            setStage('provider')
          })
          .catch(() => {
            setKeySaving(false)
            setStage('provider')
          })

        return
      }

      if (ch.toLowerCase() === 'n' || key.escape) {
        setStage('provider')

        return
      }

      return
    }

    // Remove provider confirmation stage
    if (stage === 'remove_provider') {
      if (removeSaving) {
        return
      }

      const targetProvider = providers[lastProviderIdx]
      if (!targetProvider) {
        setStage('provider')

        return
      }

      if (ch.toLowerCase() === 'y' || key.return) {
        setRemoveSaving(true)
        setRemoveError('')
        gw.request<{ removed?: boolean }>('model.remove_provider', {
          slug: targetProvider.slug,
          ...(sessionId ? { session_id: sessionId } : {})
        })
          .then(raw => {
            const r = asRpcResult<{ removed?: boolean }>(raw)

            if (r?.removed) {
              setProviders(prev => prev.filter(p => p.slug !== targetProvider.slug))
            }

            setRemoveSaving(false)
            setStage('provider')
            if (lastProviderIdx >= providers.length - 1) {
              setProviderIdx(Math.max(0, providers.length - 2))
            }
          })
          .catch((e: unknown) => {
            setRemoveError(rpcErrorMessage(e))
            setRemoveSaving(false)
          })

        return
      }

      if (ch.toLowerCase() === 'n' || key.escape) {
        setStage('provider')

        return
      }

      return
    }

    // Remove model confirmation stage
    if (stage === 'remove_model') {
      if (removeSaving) {
        return
      }

      const modelToRemove = models[lastModelIdx]
      if (!modelToRemove || !provider) {
        setStage('provider')

        return
      }

      if (ch.toLowerCase() === 'y' || key.return) {
        setRemoveSaving(true)
        setRemoveError('')
        gw.request<{ removed?: boolean }>('model.remove_model', {
          slug: provider.slug,
          model: modelToRemove,
          ...(sessionId ? { session_id: sessionId } : {})
        })
          .then(raw => {
            const r = asRpcResult<{ removed?: boolean }>(raw)

            if (r?.removed) {
              setProviders(prev =>
                prev.map(p =>
                  p.slug === provider.slug
                    ? { ...p, models: p.models?.filter(m => m !== modelToRemove) ?? [], total_models: (p.total_models ?? 0) - 1 }
                    : p
                )
              )
            }

            setRemoveSaving(false)
            if (models.length <= 1) {
              setStage('provider')
            } else {
              setStage('model')
              setModelIdx(Math.max(0, lastModelIdx >= models.length - 1 ? models.length - 2 : lastModelIdx))
            }
          })
          .catch((e: unknown) => {
            setRemoveError(rpcErrorMessage(e))
            setRemoveSaving(false)
          })

        return
      }

      if (ch.toLowerCase() === 'n' || key.escape) {
        setStage('model')

        return
      }

      return
    }

    const count =
      stage === 'provider'
        ? providers.length + 2
        : stage === 'model'
          ? (models.length > 0 ? models.length + 2 : models.length + 1)
          : 0
    const sel = stage === 'provider' ? providerIdx : modelIdx
    const setSel = stage === 'provider' ? setProviderIdx : setModelIdx

    if (key.upArrow && sel > 0) {
      const next = sel - 1
      setSel(next)
      if (stage === 'provider' && next < providers.length) setLastProviderIdx(next)
      if (stage === 'model' && next < models.length) setLastModelIdx(next)

      return
    }

    if (key.downArrow && sel < count - 1) {
      const next = sel + 1
      setSel(next)
      if (stage === 'provider' && next < providers.length) setLastProviderIdx(next)
      if (stage === 'model' && next < models.length) setLastModelIdx(next)

      return
    }

    if (key.return) {
      if (stage === 'provider') {
        if (providerIdx === providers.length) {
          setStage('custom_provider')
          setCustomProviderSlug('')
          setCustomProviderUrl('')
          setCustomProviderKey('')
          setCustomProviderProxy('')
          setCustomProviderField(0)
          setCustomSaving(false)
          setCustomError('')

          return
        }

        if (providerIdx === providers.length + 1) {
          setStage('remove_provider')
          setRemoveSaving(false)
          setRemoveError('')

          return
        }

        if (!provider) {
          return
        }

        if (provider.authenticated === false) {
          // api_key providers: prompt for key inline
          if (provider.auth_type === 'api_key' && provider.key_env) {
            setStage('key')
            setKeyInput('')
            setKeyError('')
          }

          // Other auth types: no-op (warning shown tells them to run coder model)
          return
        }

        setStage('model')
        setModelIdx(0)

        return
      }

      if (modelIdx === models.length) {
        setStage('custom_model')
        setCustomModelName('')
        setCustomModelSaving(false)
        setCustomModelError('')

        return
      }

      if (modelIdx === models.length + 1 && models.length > 0) {
        setStage('remove_model')
        setRemoveSaving(false)
        setRemoveError('')

        return
      }

      const model = models[modelIdx]

      if (provider && model) {
        onSelect(
          `${model} --provider ${provider.slug}${allowPersistGlobal && persistGlobal ? ' --global' : ` ${TUI_SESSION_MODEL_FLAG}`}`
        )
      } else {
        setStage('provider')
      }

      return
    }

    if (allowPersistGlobal && ch.toLowerCase() === 'g') {
      setPersistGlobal(v => !v)

      return
    }

    // Disconnect: only in provider stage, only for authenticated providers
    if (ch.toLowerCase() === 'd' && stage === 'provider' && provider?.authenticated !== false) {
      setStage('disconnect')

      return
    }
  })

  if (loading) {
    return <Text color={t.color.muted}>loading models…</Text>
  }

  if (err) {
    return (
      <Box flexDirection="column">
        <Text color={t.color.label}>error: {err}</Text>
        <OverlayHint t={t}>Esc/q cancel</OverlayHint>
      </Box>
    )
  }

  if (!providers.length) {
    return (
      <Box flexDirection="column">
        <Text color={t.color.muted}>no providers available</Text>
        <OverlayHint t={t}>Esc/q cancel</OverlayHint>
      </Box>
    )
  }

  // ── Key entry stage ──────────────────────────────────────────────────
  if (stage === 'key' && provider) {
    const masked = keyInput ? '•'.repeat(Math.min(keyInput.length, 40)) : ''

    return (
      <Box flexDirection="column" width={width}>
        <Text bold color={t.color.accent} wrap="truncate-end">
          Configure {provider.name}
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          Paste your API key below (saved to ~/.coder/.env)
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          {' '}
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          {provider.key_env}:
        </Text>

        <Text color={t.color.accent} wrap="truncate-end">
          {'  '}
          {masked || '(empty)'}
          {keySaving ? '' : '▎'}
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          {' '}
        </Text>

        {keyError ? (
          <Text color={t.color.label} wrap="truncate-end">
            error: {keyError}
          </Text>
        ) : keySaving ? (
          <Text color={t.color.muted} wrap="truncate-end">
            saving…
          </Text>
        ) : (
          <Text color={t.color.muted} wrap="truncate-end">
            {' '}
          </Text>
        )}

        <OverlayHint t={t}>Enter save · Ctrl+U clear · Esc back</OverlayHint>
      </Box>
    )
  }

  // ── Disconnect confirmation stage ─────────────────────────────────────
  if (stage === 'disconnect' && provider) {
    return (
      <Box flexDirection="column" width={width}>
        <Text bold color={t.color.accent} wrap="truncate-end">
          Disconnect {provider.name}?
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          {' '}
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          This removes saved credentials for {provider.name}.
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          You can re-authenticate later by selecting it again.
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          {' '}
        </Text>

        {keySaving ? (
          <Text color={t.color.muted} wrap="truncate-end">
            disconnecting…
          </Text>
        ) : (
          <OverlayHint t={t}>y/Enter confirm · n/Esc cancel</OverlayHint>
        )}
      </Box>
    )
  }

  // ── Remove provider confirmation stage ────────────────────────────────
  if (stage === 'remove_provider') {
    const targetProvider = providers[lastProviderIdx]

    if (!targetProvider) {
      return (
        <Box flexDirection="column" width={width}>
          <Text color={t.color.label}>No provider selected to remove.</Text>
          <OverlayHint t={t}>Esc back</OverlayHint>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" width={width}>
        <Text bold color={t.color.accent} wrap="truncate-end">
          Remove {targetProvider.name}?
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          {' '}
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          This permanently removes {targetProvider.name} from settings.
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          All associated models and credentials will be removed.
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          {' '}
        </Text>

        {removeError ? (
          <Text color={t.color.label} wrap="truncate-end">
            error: {removeError}
          </Text>
        ) : removeSaving ? (
          <Text color={t.color.muted} wrap="truncate-end">
            removing…
          </Text>
        ) : (
          <OverlayHint t={t}>y/Enter confirm · n/Esc cancel</OverlayHint>
        )}
      </Box>
    )
  }

  // ── Custom provider creation stage ────────────────────────────────────
  if (stage === 'custom_provider') {
    const fieldLabels = ['Provider slug', 'Base URL (optional)', 'API Key (optional)', 'Proxy URL (optional)']
    const fieldValues = [customProviderSlug, customProviderUrl, customProviderKey, customProviderProxy]
    const fieldMasked = [false, false, true, false]

    return (
      <Box flexDirection="column" width={width}>
        <Text bold color={t.color.accent} wrap="truncate-end">
          Custom Provider Setup
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          Enter provider details · Enter advances to next field
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          {' '}
        </Text>

        {fieldLabels.map((label, i) => {
          const isActive = customProviderField === i
          const raw = fieldValues[i]
          const display = fieldMasked[i] && raw ? '•'.repeat(Math.min(raw.length, 40)) : raw || '(empty)'

          return (
            <Box key={label} flexDirection="column">
              <Text
                bold={isActive}
                color={isActive ? t.color.accent : t.color.muted}
                wrap="truncate-end"
              >
                {isActive ? '▸ ' : '  '}{label}:
              </Text>
              <Text
                color={isActive ? t.color.accent : t.color.muted}
                wrap="truncate-end"
              >
                {'    '}{display}{isActive && !customSaving ? '▎' : ''}
              </Text>
            </Box>
          )
        })}

        <Text color={t.color.muted} wrap="truncate-end">
          {' '}
        </Text>

        {customError ? (
          <Text color={t.color.label} wrap="truncate-end">
            error: {customError}
          </Text>
        ) : customSaving ? (
          <Text color={t.color.muted} wrap="truncate-end">
            saving…
          </Text>
        ) : (
          <Text color={t.color.muted} wrap="truncate-end">
            {' '}
          </Text>
        )}

        <OverlayHint t={t}>
          {customProviderField < 3
            ? 'Enter next field · Ctrl+U clear field · Esc back'
            : 'Enter save · Ctrl+U clear field · Esc back'}
        </OverlayHint>
      </Box>
    )
  }

  // ── Provider selection stage ─────────────────────────────────────────
  if (stage === 'provider') {
    const rows = providers.map((p, i) => {
      const authMark = p.authenticated === false ? '○' : p.is_current ? '*' : '●'
      const modelCount = p.total_models ?? p.models?.length ?? 0
      const suffix =
        p.authenticated === false
          ? (p.auth_type === 'api_key' ? '(no key)' : '(needs setup)')
          : p.is_current
            ? `${modelCount} models  <- currently active`
            : `${modelCount} models`

      return `${authMark} ${names[i]} · ${suffix}`
    })

    rows.push('Custom new provider')
    rows.push('Remove provider')

    const { items, offset } = windowItems(rows, providerIdx, VISIBLE)

    return (
      <Box flexDirection="column" width={width}>
        <Text bold color={t.color.accent} wrap="truncate-end">
          Select provider (step 1/2)
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          Full model IDs on the next step · Enter to continue
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          Current: {currentModel || '(unknown)'}
        </Text>
        <Text color={t.color.label} wrap="truncate-end">
          {provider?.warning ? `warning: ${provider.warning}` : ' '}
        </Text>
        <Text color={t.color.muted} wrap="truncate-end">
          {offset > 0 ? ` ↑ ${offset} more` : ' '}
        </Text>

        {Array.from({ length: VISIBLE }, (_, i) => {
          const row = items[i]
          const idx = offset + i
          const p = providers[idx]
          const dimmed = p?.authenticated === false

          return row ? (
            <Text
              bold={providerIdx === idx}
              color={providerIdx === idx ? t.color.accent : dimmed ? t.color.label : t.color.muted}
              inverse={providerIdx === idx}
              key={providers[idx]?.slug ?? `row-${idx}`}
              wrap="truncate-end"
            >
              {providerIdx === idx ? '▸ ' : '  '}
              {idx + 1}. {row}
            </Text>
          ) : (
            <Text color={t.color.muted} key={`pad-${i}`} wrap="truncate-end">
              {' '}
            </Text>
          )
        })}

        <Text color={t.color.muted} wrap="truncate-end">
          {offset + VISIBLE < rows.length ? ` ↓ ${rows.length - offset - VISIBLE} more` : ' '}
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          persist: {allowPersistGlobal ? (persistGlobal ? 'global' : 'session') : 'session'}
          {allowPersistGlobal ? ' · g toggle' : ' only'}
        </Text>
        <OverlayHint t={t}>↑/↓ select · Enter choose · d disconnect · Esc/q cancel</OverlayHint>
      </Box>
    )
  }

  // ── Model selection stage ────────────────────────────────────────────
  const displayModels = models.length > 0 ? [...models, 'Custom model name', 'Remove model'] : [...models, 'Custom model name']
  const { items, offset } = windowItems(displayModels, modelIdx, VISIBLE)

  return (
    <Box flexDirection="column" width={width}>
      <Text bold color={t.color.accent} wrap="truncate-end">
        Select model (step 2/2)
      </Text>

      <Text color={t.color.muted} wrap="truncate-end">
        {names[providerIdx] || '(unknown provider)'} · Esc back
      </Text>
      <Text color={t.color.label} wrap="truncate-end">
        {provider?.warning ? `warning: ${provider.warning}` : ' '}
      </Text>
      <Text color={t.color.muted} wrap="truncate-end">
        {offset > 0 ? ` ↑ ${offset} more` : ' '}
      </Text>

      {Array.from({ length: VISIBLE }, (_, i) => {
        const row = items[i]
        const idx = offset + i

        if (!row) {
          return !models.length && i === 0 ? (
            <Text color={t.color.muted} key="empty" wrap="truncate-end">
              no models listed for this provider
            </Text>
          ) : (
            <Text color={t.color.muted} key={`pad-${i}`} wrap="truncate-end">
              {' '}
            </Text>
          )
        }

        const prefix = modelIdx === idx ? '▸ ' : row === currentModel ? '* ' : '  '

        return (
          <Text
            bold={modelIdx === idx}
            color={modelIdx === idx ? t.color.accent : t.color.muted}
            inverse={modelIdx === idx}
            key={`${provider?.slug ?? 'prov'}:${idx}:${row}`}
            wrap="truncate-end"
          >
            {prefix}
            {idx + 1}. {row}
          </Text>
        )
      })}

      <Text color={t.color.muted} wrap="truncate-end">
        {offset + VISIBLE < displayModels.length ? ` ↓ ${displayModels.length - offset - VISIBLE} more` : ' '}
      </Text>

      <Text color={t.color.muted} wrap="truncate-end">
        persist: {allowPersistGlobal ? (persistGlobal ? 'global' : 'session') : 'session'}
        {allowPersistGlobal ? ' · g toggle' : ' only'}
      </Text>
      <OverlayHint t={t}>
        {models.length ? '↑/↓ select · Enter switch · Esc back · q close' : 'Enter/Esc back · q close'}
      </OverlayHint>
    </Box>
  )

  // ── Remove model confirmation stage ───────────────────────────────────
  if (stage === 'remove_model' && provider) {
    const modelToRemove = models[lastModelIdx]

    if (!modelToRemove) {
      return (
        <Box flexDirection="column" width={width}>
          <Text color={t.color.label}>No model selected to remove.</Text>
          <OverlayHint t={t}>Esc back</OverlayHint>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" width={width}>
        <Text bold color={t.color.accent} wrap="truncate-end">
          Remove model from {provider.name}?
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          {' '}
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          Model: {modelToRemove}
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          {' '}
        </Text>

        {removeError ? (
          <Text color={t.color.label} wrap="truncate-end">
            error: {removeError}
          </Text>
        ) : removeSaving ? (
          <Text color={t.color.muted} wrap="truncate-end">
            removing…
          </Text>
        ) : (
          <OverlayHint t={t}>y/Enter confirm · n/Esc cancel</OverlayHint>
        )}
      </Box>
    )
  }

  // ── Custom model name stage ───────────────────────────────────────────
  if (stage === 'custom_model' && provider) {
    return (
      <Box flexDirection="column" width={width}>
        <Text bold color={t.color.accent} wrap="truncate-end">
          Custom Model for {provider.name}
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          Enter the model name/ID (e.g. gpt-4o, claude-sonnet-4-20250514)
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          {' '}
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          Model name:
        </Text>

        <Text color={t.color.accent} wrap="truncate-end">
          {'  '}
          {customModelName || '(empty)'}
          {customModelSaving ? '' : '▎'}
        </Text>

        <Text color={t.color.muted} wrap="truncate-end">
          {' '}
        </Text>

        {customModelError ? (
          <Text color={t.color.label} wrap="truncate-end">
            error: {customModelError}
          </Text>
        ) : customModelSaving ? (
          <Text color={t.color.muted} wrap="truncate-end">
            saving…
          </Text>
        ) : (
          <Text color={t.color.muted} wrap="truncate-end">
            {' '}
          </Text>
        )}

        <OverlayHint t={t}>Enter save · Ctrl+U clear · Esc back</OverlayHint>
      </Box>
    )
  }
}

interface ModelPickerProps {
  allowPersistGlobal?: boolean
  gw: IGatewayClient
  onCancel: () => void
  onSelect: (value: string) => void
  sessionId: string | null
  t: Theme
}
