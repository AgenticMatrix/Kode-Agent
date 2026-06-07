export const TOOL_VERBS: Record<string, string> = {
  browser: 'browsing',
  clarify: 'asking',
  create_file: 'creating',
  delegate_task: 'delegating',
  delete_file: 'deleting',
  execute_code: 'executing',
  image_generate: 'generating',
  list_files: 'listing',
  memory: 'remembering',
  patch: 'patching',
  read_file: 'reading',
  run_command: 'running',
  search_code: 'searching',
  search_files: 'searching',
  terminal: 'terminal',
  web_extract: 'extracting',
  web_search: 'searching',
  write_file: 'writing'
}

/**
 * @deprecated FaceTicker no longer rotates through random verbs.
 * The status bar now shows actual LLM state from the bridge
 * ('Thinking…', 'Generating…', 'Running Bash…', etc.).
 * Kept for VERB_PAD_LEN padding calculation in appChrome.tsx and
 * for THINKING_STATUS_RE / THINKING_STATUS_CHUNK_RE in text.ts.
 */
export const VERBS = [
  'pondering',
  'contemplating',
  'musing',
  'cogitating',
  'ruminating',
  'deliberating',
  'mulling',
  'reflecting',
  'processing',
  'reasoning',
  'analyzing',
  'computing',
  'synthesizing',
  'formulating',
  'brainstorming'
]

// ---------------------------------------------------------------------------
// Deterministic status verb — replaces random verb cycling in FaceTicker.
// ---------------------------------------------------------------------------

export interface StatusVerbState {
  busy: boolean
  status: string
}

/**
 * Generic / transitional statuses that carry no specific semantic meaning.
 * When the current status matches one of these we fall back to "Thinking"
 * so the user always sees an informative label rather than "running…" or
 * a stale "ready" from a previous turn.
 */
const GENERIC_STATUSES = new Set([
  'running…',
  'ready',
  'interrupted',
  'summoning Coder…',
  'forging session…',
  'resuming…',
  'resuming most recent…',
  'starting agent…'
])

/**
 * Maximum length for a status label displayed in the FaceTicker.
 * Labels longer than this (e.g. raw LLM chain-of-thought text leaking
 * from a misrouted thinking_delta event) are treated as generic and
 * fall back to "Thinking".  Legitimate status labels produced by the
 * bridge are always short: "Thinking", "Generating", "Running Bash",
 * "Used 2 tool(s): Read, Write".
 */
const MAX_STATUS_LABEL_LEN = 50

/**
 * Return a human-readable verb for the FaceTicker status segment.
 *
 * - Not busy         → "Ready"
 * - Busy, specific   → status text with trailing "…" stripped
 * - Busy, generic    → "Thinking" (fallback)
 * - Status too long  → "Thinking" (defense-in-depth against raw text leak)
 */
export function getStatusVerb(state: StatusVerbState): string {
  if (!state.busy) return 'Ready'

  const s = (state.status || '').replace(/…$/, '').trim()

  // Defense-in-depth: if the status text is suspiciously long it is
  // almost certainly raw model output that leaked through a misrouted
  // thinking_delta event.  Fall back to a clean label.
  if (s.length > MAX_STATUS_LABEL_LEN) return 'Thinking'

  if (s && !GENERIC_STATUSES.has(state.status) && !GENERIC_STATUSES.has(`${s}…`)) {
    return s
  }

  return 'Thinking'
}
