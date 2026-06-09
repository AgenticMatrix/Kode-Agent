import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { AppConfig } from '../types.js';

// ---------------------------------------------------------------------------
// Settings types — matches ~/.coder/settings.json format
// ---------------------------------------------------------------------------

export interface ModelEntry {
  /** List of model IDs available for this provider */
  model: string[];
  /** Provider endpoint URL */
  base_url?: string;
  /** API key / auth token */
  auth_token_env?: string;
  /** HTTP/HTTPS proxy URL */
  proxy?: string;
  /** Maximum output tokens for this provider */
  max_tokens?: number;
  /** Provider identifier (anthropic, deepseek, openai, etc.) */
  provider?: string;
}

export interface CoderSettings {
  env?: Record<string, string>;
  model_list?: ModelEntry[];
  /** Format: "provider/model-name" (e.g. "deepseek/deepseek-v4-pro") */
  default_model?: string;
  /** Global max output tokens (default: 32768) */
  max_tokens?: number;
  /** UI theme (dark / light) */
  theme?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function inferProvider(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes('deepseek')) return 'deepseek';
  if (lower.includes('openai') || lower.includes('gpt') || lower.includes('o1') || lower.includes('o3') || lower.includes('o4')) return 'openai';
  return 'anthropic';
}

function loadSettings(): CoderSettings {
  try {
    const raw = readFileSync(join(homedir(), '.coder', 'settings.json'), 'utf-8');
    return JSON.parse(raw) as CoderSettings;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Model resolution — matches KodeAgent priority:
//   1. CODER_MODEL env var (highest)
//   2. default_model parsed as "provider/model-name", looked up in model_list
//   3. First entry in model_list
//   4. Legacy env vars in settings.env
// ---------------------------------------------------------------------------

function resolveModel(settings: CoderSettings): {
  model: string;
  baseUrl: string;
  apiKey: string;
  proxy?: string;
  maxTokens?: number;
  provider: string;
} {
  const parseDefault = (raw: string) => {
    const parts = raw.split('/');
    return { providerName: parts[0]!, modelName: parts.length > 1 ? parts[1] : undefined };
  };

  const resolveFromEntry = (entry: ModelEntry, preferredModel?: string) => {
    const selectedModel = preferredModel
      ? (entry.model.find(m => m === preferredModel) ?? entry.model[0]!)
      : entry.model[0]!;
    return {
      model: selectedModel,
      baseUrl: entry.base_url ?? '',
      apiKey: entry.auth_token_env ?? '',
      proxy: entry.proxy,
      maxTokens: entry.max_tokens,
      provider: entry.provider ?? inferProvider(selectedModel),
    };
  };

  // 1. CODER_MODEL env var
  const coderModel = process.env.CODER_MODEL;
  if (coderModel) {
    if (settings.model_list) {
      const { providerName, modelName } = parseDefault(coderModel);
      const entry = settings.model_list.find(m => m.provider === providerName);
      if (entry && entry.model.length > 0) {
        return resolveFromEntry(entry, modelName);
      }
      for (const entry of settings.model_list) {
        const matched = entry.model.find(m => m === coderModel);
        if (matched) {
          return resolveFromEntry(entry, matched);
        }
      }
    }
    return {
      model: coderModel,
      baseUrl: '',
      apiKey: '',
      provider: inferProvider(coderModel),
    };
  }

  // 2. default_model from settings
  const defaultName = settings.default_model;
  if (defaultName && settings.model_list) {
    const { providerName, modelName } = parseDefault(defaultName);
    const entry = settings.model_list.find(m => m.provider === providerName);
    if (entry && entry.model.length > 0) {
      return resolveFromEntry(entry, modelName);
    }
  }

  // 3. First entry in model_list
  if (settings.model_list && settings.model_list.length > 0) {
    const entry = settings.model_list[0]!;
    if (entry.model.length > 0) {
      return resolveFromEntry(entry);
    }
  }

  // 4. Legacy env fallback
  const env = settings.env ?? {};
  return {
    model: env.CODER_MODEL ?? 'claude-sonnet-4-6',
    baseUrl: env.CODER_BASE_URL ?? '',
    apiKey: env.CODER_AUTH_TOKEN ?? '',
    provider: 'anthropic',
  };
}

// ---------------------------------------------------------------------------
// Public API — loadConfig
// ---------------------------------------------------------------------------

/**
 * Load AI model configuration from ~/.coder/settings.json.
 *
 * Supports KodeAgent-compatible format:
 * {
 *   "model_list": [
 *     { "model": ["deepseek-v4-pro"], "provider": "deepseek",
 *       "base_url": "https://api.deepseek.com/anthropic", "auth_token_env": "sk-..." }
 *   ],
 *   "default_model": "deepseek/deepseek-v4-pro"
 * }
 *
 * Also supports legacy format:
 * {
 *   "env": {
 *     "CODER_BASE_URL": "...",
 *     "CODER_AUTH_TOKEN": "...",
 *     "CODER_MODEL": "..."
 *   }
 * }
 */
export function loadConfig(): AppConfig {
  const settings = loadSettings();

  const resolved = resolveModel(settings);

  // Env vars override file config
  const apiKey =
    process.env.CODER_AUTH_TOKEN ??
    resolved.apiKey ??
    '';

  const baseUrl =
    process.env.CODER_BASE_URL ??
    resolved.baseUrl ??
    '';

  const model =
    process.env.CODER_MODEL ??
    resolved.model ??
    '';

  const proxy =
    process.env.CODER_PROXY ??
    resolved.proxy;

  const maxTokens = (() => {
    if (process.env.CODER_MAX_TOKENS) {
      const n = parseInt(process.env.CODER_MAX_TOKENS, 10);
      if (!isNaN(n)) return n;
    }
    return resolved.maxTokens ?? settings.max_tokens;
  })();

  if (!model) {
    throw new Error(
      'No model configured. Set CODER_MODEL in ~/.coder/settings.json (model_list) or env.',
    );
  }

  return { baseUrl, apiKey, model, provider: resolved.provider, proxy, maxTokens };
}
