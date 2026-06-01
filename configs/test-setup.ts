/**
 * Global test setup for Kode Agent.
 *
 * Invariants enforced here (inspired by Hermes Agent's conftest.py):
 *
 * 1. **No credential env vars.** All provider/credential-shaped env vars
 *    are unset before every test. Local developer keys cannot leak in.
 *
 * 2. **Deterministic runtime.** TZ=UTC, LANG=C.UTF-8, NODE_ENV=test.
 *
 * 3. **Isolated KODE_HOME.** KODE_HOME points to a per-test tempdir so
 *    code reading `~/.kode/*` cannot see the real one.
 *
 * These invariants make the local test run match CI closely.
 */

import { afterEach, beforeEach, vi } from 'vitest';

// ── Credential env-var filter ─────────────────────────────────────────────

const CREDENTIAL_SUFFIXES = [
  '_API_KEY',
  '_TOKEN',
  '_SECRET',
  '_PASSWORD',
  '_CREDENTIALS',
  '_ACCESS_KEY',
  '_SECRET_ACCESS_KEY',
  '_PRIVATE_KEY',
  '_OAUTH_TOKEN',
  '_ENCRYPT_KEY',
  '_APP_SECRET',
  '_CLIENT_SECRET',
  '_AES_KEY',
];

const CREDENTIAL_NAMES = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_TOKEN',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GROQ_API_KEY',
  'XAI_API_KEY',
  'MISTRAL_API_KEY',
  'DEEPSEEK_API_KEY',
  'MOONSHOT_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
]);

function looksLikeCredential(name: string): boolean {
  if (CREDENTIAL_NAMES.has(name)) return true;
  return CREDENTIAL_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

// ── Behavioral vars that change test semantics ────────────────────────────

const BEHAVIORAL_VARS = new Set([
  'KODE_HOME',
  'KODE_CONFIG',
  'KODE_MODEL',
  'KODE_PROVIDER',
  'KODE_PERMISSION_MODE',
  'KODE_YOLO_MODE',
  'NODE_ENV',
]);

// ── Per-test environment reset ────────────────────────────────────────────

/**
 * Store original env values so we can restore them after each test.
 * Individual tests that need specific env vars set them explicitly.
 */
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  // 1. Store and clear credential-shaped env vars
  for (const [name, value] of Object.entries(process.env)) {
    if (looksLikeCredential(name) || BEHAVIORAL_VARS.has(name)) {
      if (!(name in originalEnv)) {
        originalEnv[name] = value;
      }
      delete process.env[name];
    }
  }

  // 2. Set deterministic runtime env
  process.env.TZ = 'UTC';
  process.env.LANG = 'C.UTF-8';
  process.env.LC_ALL = 'C.UTF-8';
  if (!('NODE_ENV' in originalEnv)) {
    originalEnv['NODE_ENV'] = process.env.NODE_ENV;
  }
  process.env.NODE_ENV = 'test';

  // 3. Set KODE_HOME to a temp path (test files override as needed)
  if (!('KODE_HOME' in originalEnv)) {
    originalEnv['KODE_HOME'] = process.env.KODE_HOME;
  }
  process.env.KODE_HOME = '/tmp/kode-test-home';

  // 4. Reset timer mocks
  vi.useRealTimers();
});

afterEach(() => {
  // Restore original env values
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  // Clear the stored originals so the next test starts fresh
  for (const key of Object.keys(originalEnv)) {
    delete originalEnv[key];
  }

  // Clear all mocks
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
