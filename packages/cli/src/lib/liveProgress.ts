import type { Msg, TodoItem } from '../types.js'

export const countPendingTodos = (todos: readonly TodoItem[]) =>
  todos.filter(todo => todo.status === 'in_progress' || todo.status === 'pending').length

export const isTodoDone = (todos: readonly TodoItem[]) =>
  todos.length > 0 && todos.every(todo => todo.status === 'completed' || todo.status === 'cancelled')

export const isToolShelfMessage = (msg: Msg | undefined) =>
  Boolean(msg?.kind === 'trail' && !msg.text && !msg.thinking?.trim() && msg.tools?.length)

export const canHoldToolShelf = (msg: Msg | undefined) =>
  Boolean(msg?.kind === 'trail' && !msg.text && (msg.thinking?.trim() || msg.tools?.length))

export const mergeToolShelfInto = (target: Msg, source: Msg): Msg => {
  const currentTools = target.tools ?? []
  const newTools = source.tools ?? []

  // Preserve object identity when there is nothing new to add.
  // This avoids creating a fresh Msg reference that would skip
  // AppendToolShelfMessage's shallow array copy and churn downstream
  // content-keyed caches (messageId, vdom reconciliation).
  if (newTools.length === 0) return target

  const merged = [...currentTools, ...newTools]

  // If every incoming tool was already present (merged length equals
  // current length) there is no actual change — keep the same reference.
  if (merged.length === currentTools.length) return target

  return { ...target, tools: merged }
}

const isBarrierMessage = (msg: Msg | undefined) => {
  if (!msg) {
    return true
  }

  // Assistant text, user input, intro/panel rows all terminate the shelf.
  if (msg.kind === 'intro' || msg.kind === 'panel' || msg.kind === 'diff') {
    return true
  }

  if (msg.role && msg.role !== 'system') {
    return true
  }

  if (msg.text) {
    return true
  }

  return false
}

const isToolCarryingTrail = (msg: Msg | undefined) => Boolean(msg?.kind === 'trail' && !msg.text && msg.tools?.length)

export const appendToolShelfMessage = (prev: readonly Msg[], msg: Msg): Msg[] => {
  if (!isToolShelfMessage(msg)) {
    return [...prev, msg]
  }

  let fallbackHolder: number | null = null

  for (let index = prev.length - 1; index >= 0; index--) {
    const candidate = prev[index]

    if (isToolCarryingTrail(candidate)) {
      const next = [...prev]

      next[index] = mergeToolShelfInto(candidate!, msg)

      return next
    }

    if (fallbackHolder === null && canHoldToolShelf(candidate)) {
      fallbackHolder = index
    }

    if (isBarrierMessage(candidate)) {
      break
    }
  }

  if (fallbackHolder !== null) {
    const next = [...prev]

    next[fallbackHolder] = mergeToolShelfInto(prev[fallbackHolder]!, msg)

    return next
  }

  return [...prev, msg]
}
