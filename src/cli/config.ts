import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { AppConfig } from '../types.js';

// ---------------------------------------------------------------------------
// Settings types — matches ~/.coder/settings.json format
// ---------------------------------------------------------------------------

export interface ModelPrice {
  input: number;
  output: number;
  cache_read_input?: number;
  currency?: string;
  unit?: number;
  concurrency?: number;
}

export interface ModelItem {
  name: string;
  price?: ModelPrice;
}

export interface ModelEntry {
  /** List of model IDs available for this provider — strings or {name, price} objects */
  model: Array<string | ModelItem>;
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
  /** Max concurrent tool executions (default: 32, range: 1-256). */
  max_tool_concurrency?: number;
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

export function loadSettings(): CoderSettings {
  try {
    const raw = readFileSync(join(homedir(), '.coder', 'settings.json'), 'utf-8');
    return JSON.parse(raw) as CoderSettings;
  } catch {
    return {};
  }
}

/** Resolve max tool concurrency from settings, with bounds checking. */
export function getMaxToolConcurrency(settings?: CoderSettings): number {
  const val = settings?.max_tool_concurrency;
  if (typeof val === 'number' && val >= 1 && val <= 256) return val;
  return 32;
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
  currency?: string;
  inputPrice?: number;
  outputPrice?: number;
  cacheReadPrice?: number;
} {
  const parseDefault = (raw: string) => {
    const parts = raw.split('/');
    return { providerName: parts[0]!, modelName: parts.length > 1 ? parts[1] : undefined };
  };

  const modelName = (m: string | ModelItem): string =>
    typeof m === 'string' ? m : m.name;

  const modelPrice = (m: string | ModelItem): ModelPrice | undefined =>
    typeof m === 'string' ? undefined : m.price;

  const resolveFromEntry = (entry: ModelEntry, preferredModel?: string) => {
    const list = entry.model;
    const found = preferredModel
      ? list.find(m => modelName(m) === preferredModel) ?? list[0]
      : list[0];
    const selectedModel = modelName(found!);
    const price = found ? modelPrice(found) : undefined;
    return {
      model: selectedModel,
      baseUrl: entry.base_url ?? '',
      apiKey: entry.auth_token_env ?? '',
      proxy: entry.proxy,
      maxTokens: entry.max_tokens,
      provider: entry.provider ?? inferProvider(selectedModel),
      currency: price?.currency,
      inputPrice: price?.input,
      outputPrice: price?.output,
      cacheReadPrice: price?.cache_read_input,
    };
  };

  // 1. default_model from settings ("provider/model-name" format)
  const defaultName = settings.default_model;
  if (defaultName && settings.model_list) {
    const { providerName, modelName } = parseDefault(defaultName);
    const entry = settings.model_list.find(m => m.provider === providerName);
    if (entry && entry.model.length > 0) {
      return resolveFromEntry(entry, modelName);
    }
  }

  // 2. First entry in model_list
  if (settings.model_list && settings.model_list.length > 0) {
    const entry = settings.model_list[0]!;
    if (entry.model.length > 0) {
      return resolveFromEntry(entry);
    }
  }

  throw new Error(
    'No model configured. Add model_list to ~/.coder/settings.json.',
  );
}

// ---------------------------------------------------------------------------
// Public API — loadConfig
// ---------------------------------------------------------------------------

/**
 * Load AI model configuration from ~/.coder/settings.json.
 *
 * Resolution priority:
 *   1. default_model — "provider/model-name" format, looked up in model_list
 *   2. First entry in model_list
 *
 * Settings format:
 * {
 *   "model_list": [
 *     { "model": ["deepseek-v4-pro"], "provider": "deepseek",
 *       "base_url": "https://api.deepseek.com/anthropic", "auth_token_env": "sk-..." }
 *   ],
 *   "default_model": "deepseek/deepseek-v4-pro"
 * }
 */
export function loadConfig(): AppConfig {
  const settings = loadSettings();

  const resolved = resolveModel(settings);

  const model = resolved.model;
  const apiKey = resolved.apiKey;
  const baseUrl = resolved.baseUrl;
  const proxy = resolved.proxy;
  const maxTokens = resolved.maxTokens ?? settings.max_tokens;

  if (!model) {
    throw new Error(
      'No model configured. Set default_model in ~/.coder/settings.json.',
    );
  }

  return { baseUrl, apiKey, model, provider: resolved.provider, proxy, maxTokens, currency: resolved.currency, inputPrice: resolved.inputPrice, outputPrice: resolved.outputPrice, cacheReadPrice: resolved.cacheReadPrice };
}
