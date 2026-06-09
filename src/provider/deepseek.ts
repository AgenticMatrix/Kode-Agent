/**
 * DeepSeek Provider — DeepSeek API via OpenAI-compatible endpoint.
 *
 * Extends OpenAICompatProvider with DeepSeek-specific optimizations:
 *   - Primary endpoint: https://api.deepseek.com/anthropic
 *   - Prefix caching optimization via X-DS-Prefix-Cache header
 *   - DeepSeek-specific pricing
 */

import type { ProviderConfig, ModelInfo } from './base.js';
import { OpenAICompatProvider } from './openai-compat.js';

// ---------------------------------------------------------------------------
// DeepSeek Pricing (per 1M tokens)
// ---------------------------------------------------------------------------

const DEEPSEEK_PRICING: Record<string, { input: number; output: number }> = {
  'deepseek-chat': { input: 0.14, output: 0.28 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  default: { input: 0.14, output: 0.28 },
};

// ---------------------------------------------------------------------------
// DeepSeek Provider
// ---------------------------------------------------------------------------

export class DeepSeekProvider extends OpenAICompatProvider {
  constructor(config: ProviderConfig) {
    super(config, 'deepseek', 'https://api.deepseek.com/anthropic');
  }

  protected override buildRequestHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      'X-DS-Prefix-Cache': 'enabled',
    };
  }

  protected override getPricingForModel(model: string): { input: number; output: number } {
    return DEEPSEEK_PRICING[model] ?? DEEPSEEK_PRICING.default!;
  }

  protected override buildStreamUrl(baseUrl: string): string { return `${baseUrl}/v1/chat/completions`; }

  override async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: 'deepseek-chat',
        name: 'DeepSeek-V3',
        provider: 'deepseek',
        contextWindow: 64_000,
        maxOutputTokens: 8192,
        supportsTools: true,
        supportsVision: false,
        pricing: { input: 0.14, output: 0.28, cacheRead: 0.014 },
      },
      {
        id: 'deepseek-reasoner',
        name: 'DeepSeek-R1',
        provider: 'deepseek',
        contextWindow: 64_000,
        maxOutputTokens: 8192,
        supportsTools: false,
        supportsVision: false,
        pricing: { input: 0.55, output: 2.19, cacheRead: 0.14 },
      },
    ];
  }
}
