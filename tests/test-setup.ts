/**
 * Global test setup — deterministic runtime environment.
 *
 * 1. No credential env vars — prevents accidentall local key leaks.
 * 2. Deterministic runtime: TZ=UTC, NODE_ENV=test.
 * 3. Restored env + cleared mocks after each test.
 */

import { afterEach, beforeEach, vi } from 'vitest';

const CREDENTIAL_SUFFIXES = [
  '_API_KEY', '_TOKEN', '_SECRET', '_PASSWORD', '_CREDENTIALS',
  '_ACCESS_KEY', '_SECRET_ACCESS_KEY', '_PRIVATE_KEY',
  '_OAUTH_TOKEN', '_ENCRYPT_KEY', '_APP_SECRET', '_CLIENT_SECRET',
];

const CREDENTIAL_NAMES = new Set([
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY',
  'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'DEEPSEEK_API_KEY',
  'GITHUB_TOKEN', 'GH_TOKEN',
]);

function looksLikeCredential(name: string): boolean {
  if (CREDENTIAL_NAMES.has(name)) return true;
  return CREDENTIAL_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

const BEHAVIORAL_VARS = new Set(['NODE_ENV']);

const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const [name, value] of Object.entries(process.env)) {
    if (looksLikeCredential(name) || BEHAVIORAL_VARS.has(name)) {
      if (!(name in originalEnv)) originalEnv[name] = value;
      delete process.env[name];
    }
  }

  process.env.TZ = 'UTC';
  if (!('NODE_ENV' in originalEnv)) originalEnv['NODE_ENV'] = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';

  vi.useRealTimers();
});

afterEach(() => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  for (const key of Object.keys(originalEnv)) delete originalEnv[key];

  vi.clearAllMocks();
  vi.restoreAllMocks();
});
