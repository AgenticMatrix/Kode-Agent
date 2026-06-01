/**
 * config/loader.ts — ~/.kode/config.toml configuration loader
 *
 * Priority (highest to lowest):
 *   Environment variables > ~/.kode/config.toml > Default values
 *
 * For API keys: ANTHROPIC_API_KEY > ANTHROPIC_AUTH_TOKEN (from env or TOML)
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse } from 'toml';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw structure of ~/.kode/config.toml */
export interface KodeTomlConfig {
  env?: {
    ANTHROPIC_BASE_URL?: string;
    ANTHROPIC_AUTH_TOKEN?: string;
    ANTHROPIC_MODEL?: string;
    ANTHROPIC_API_KEY?: string;
  };
  theme?: string;
  model?: string;
}

/** Resolved user config after merging all sources */
export interface ResolvedUserConfig {
  /** API key for the provider (resolved from env or TOML) */
  apiKey?: string;
  /** Base URL for the provider */
  baseUrl?: string;
  /** Default model identifier */
  model: string;
  /** UI theme preference */
  theme: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ResolvedUserConfig = {
  model: 'deepseek-v4-pro',
  theme: 'dark',
};

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function getConfigPath(): string {
  return join(homedir(), '.kode', 'config.toml');
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/**
 * Read and parse the TOML config file.
 * Returns null if the file doesn't exist or can't be parsed.
 */
function loadTomlConfig(): KodeTomlConfig | null {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    return parse(raw) as KodeTomlConfig;
  } catch {
    return null;
  }
}

/**
 * Resolve the API key with environment variable override.
 *
 * Priority:
 *   1. process.env.ANTHROPIC_API_KEY
 *   2. process.env.ANTHROPIC_AUTH_TOKEN
 *   3. TOML env.ANTHROPIC_API_KEY
 *   4. TOML env.ANTHROPIC_AUTH_TOKEN
 */
function resolveApiKey(toml: KodeTomlConfig | null): string | undefined {
  // Environment variables take highest priority
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }
  if (process.env.ANTHROPIC_AUTH_TOKEN) {
    return process.env.ANTHROPIC_AUTH_TOKEN;
  }

  // Fall back to TOML
  if (toml?.env?.ANTHROPIC_API_KEY) {
    return toml.env.ANTHROPIC_API_KEY;
  }
  if (toml?.env?.ANTHROPIC_AUTH_TOKEN) {
    return toml.env.ANTHROPIC_AUTH_TOKEN;
  }

  return undefined;
}

/**
 * Resolve the base URL with environment variable override.
 */
function resolveBaseUrl(toml: KodeTomlConfig | null): string | undefined {
  if (process.env.ANTHROPIC_BASE_URL) {
    return process.env.ANTHROPIC_BASE_URL;
  }

  if (toml?.env?.ANTHROPIC_BASE_URL) {
    return toml.env.ANTHROPIC_BASE_URL;
  }

  return undefined;
}

/**
 * Resolve the model with environment variable override.
 */
function resolveModel(toml: KodeTomlConfig | null): string {
  if (process.env.ANTHROPIC_MODEL) {
    return process.env.ANTHROPIC_MODEL;
  }

  if (toml?.env?.ANTHROPIC_MODEL) {
    return toml.env.ANTHROPIC_MODEL;
  }

  if (toml?.model) {
    return toml.model;
  }

  return DEFAULT_CONFIG.model;
}

/**
 * Resolve the theme.
 */
function resolveTheme(toml: KodeTomlConfig | null): string {
  if (toml?.theme) {
    return toml.theme;
  }

  return DEFAULT_CONFIG.theme;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Load the full resolved user configuration.
 *
 * Reads ~/.kode/config.toml, applies environment variable overrides,
 * and falls back to defaults where no value is set.
 *
 * @returns The fully resolved user configuration
 */
export function loadConfig(): ResolvedUserConfig {
  const toml = loadTomlConfig();

  return {
    apiKey: resolveApiKey(toml),
    baseUrl: resolveBaseUrl(toml),
    model: resolveModel(toml),
    theme: resolveTheme(toml),
  };
}

/**
 * Convenience: create a full provider config from the resolved user config.
 */
export function toProviderConfig(config: ResolvedUserConfig): {
  apiKey: string;
  baseUrl?: string;
  model: string;
} {
  if (!config.apiKey) {
    throw new Error(
      'No API key configured. Set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN ' +
      'in your environment, or add it to ~/.kode/config.toml under [env].',
    );
  }

  return {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
  };
}
