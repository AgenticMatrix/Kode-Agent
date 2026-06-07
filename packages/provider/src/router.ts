/**
 * ProviderRouter — Multi-provider routing and task-to-model classification.
 *
 * Registers multiple providers with their supported models. Routes requests
 * to the appropriate provider based on the model name. Auto mode classifies
 * task complexity and selects the right model automatically.
 *
 * Task complexity levels:
 *   - simple: read/search/lookup → fast cheap models (haiku, DeepSeek-V3)
 *   - medium: write/edit/refactor → balanced models (sonnet, DeepSeek-V3)
 *   - complex: multi-file/architectural → powerful models (opus, DeepSeek-R1)
 */

import type { Provider, ProviderConfig, ModelInfo } from './base.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskComplexity = 'simple' | 'medium' | 'complex';

export interface ProviderEntry {
  /** Unique provider name (e.g. "anthropic", "openai", "deepseek") */
  name: string;
  /** The provider instance */
  provider: Provider;
  /** Models this provider handles (["*"] = all models) */
  models: string[];
}

export interface RouteResult {
  provider: Provider;
  model: string;
  providerName: string;
}

export interface ComplexityRoute {
  /** Task complexity level */
  complexity: TaskComplexity;
  /** Preferred model for this complexity level */
  model: string;
  /** Provider that hosts this model */
  providerName: string;
}

// ---------------------------------------------------------------------------
// Default complexity routing table
// ---------------------------------------------------------------------------

const DEFAULT_COMPLEXITY_ROUTES: ComplexityRoute[] = [
  // Simple tasks: fast, cheap models
  { complexity: 'simple', model: 'claude-haiku-4-5', providerName: 'anthropic' },
  { complexity: 'simple', model: 'deepseek-chat', providerName: 'deepseek' },
  { complexity: 'simple', model: 'gpt-4o-mini', providerName: 'openai' },

  // Medium tasks: balanced performance/cost
  { complexity: 'medium', model: 'claude-sonnet-4-6', providerName: 'anthropic' },
  { complexity: 'medium', model: 'deepseek-chat', providerName: 'deepseek' },
  { complexity: 'medium', model: 'gpt-4o', providerName: 'openai' },

  // Complex tasks: most capable models
  { complexity: 'complex', model: 'claude-opus-4-5', providerName: 'anthropic' },
  { complexity: 'complex', model: 'deepseek-reasoner', providerName: 'deepseek' },
  { complexity: 'complex', model: 'gpt-4o', providerName: 'openai' },
];

// ---------------------------------------------------------------------------
// Task Complexity Classification
// ---------------------------------------------------------------------------

/**
 * Keywords associated with each complexity level.
 */
const COMPLEXITY_PATTERNS: Array<{ complexity: TaskComplexity; patterns: RegExp[] }> = [
  {
    complexity: 'complex',
    patterns: [
      /architect/i, /refactor/i, /redesign/i, /migrate/i, /multi-?file/i,
      /across\s+the\s+codebase/i, /system-?wide/i, /from\s+scratch/i,
      /implement\s+a\s+new\s+feature/i, /add\s+authentication/i,
      /set\s+up\s+ci/i, /deploy/i, /security/i,
    ],
  },
  {
    complexity: 'medium',
    patterns: [
      /write/i, /edit/i, /modify/i, /update/i, /create/i, /change/i,
      /fix\s+bug/i, /add\s+test/i, /add\s+validation/i, /implement/i,
      /refactor/i, /optimize/i, /extract/i, /rename/i,
    ],
  },
  {
    complexity: 'simple',
    patterns: [
      /read/i, /search/i, /find/i, /grep/i, /look\s+up/i, /what\s+is/i,
      /where\s+is/i, /how\s+does/i, /list/i, /show/i, /explain/i,
      /check/i, /view/i, /inspect/i, /locate/i,
    ],
  },
];

/**
 * Classify a task description into a complexity level.
 */
export function classifyTaskComplexity(task: string): TaskComplexity {
  for (const { complexity, patterns } of COMPLEXITY_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(task)) {
        return complexity;
      }
    }
  }
  // Default to medium complexity for unknown tasks
  return 'medium';
}

// ---------------------------------------------------------------------------
// ProviderRouter
// ---------------------------------------------------------------------------

export class ProviderRouter {
  private providers = new Map<string, ProviderEntry>();
  private complexityRoutes: ComplexityRoute[] = [...DEFAULT_COMPLEXITY_ROUTES];

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  /**
   * Register a provider with its supported models.
   *
   * @param name — Unique provider name
   * @param provider — The Provider instance
   * @param models — Model IDs this provider handles (["*"] = all models)
   */
  register(name: string, provider: Provider, models: string[]): void {
    this.providers.set(name, { name, provider, models });
  }

  /**
   * Override the default complexity routing table.
   */
  setComplexityRoutes(routes: ComplexityRoute[]): void {
    this.complexityRoutes = routes;
  }

  // -----------------------------------------------------------------------
  // Model-based Routing
  // -----------------------------------------------------------------------

  /**
   * Select the provider for a given model.
   *
   * Searches registered providers in order. First provider that lists the
   * model (or uses the "*" wildcard) wins. Returns the provider and the
   * actual model name to use.
   *
   * @throws Error if no provider supports the requested model
   */
  selectProvider(model: string): RouteResult {
    for (const [name, entry] of this.providers) {
      if (entry.models.includes('*') || entry.models.includes(model)) {
        return { provider: entry.provider, model, providerName: name };
      }
    }

    // Check if the model name implies a provider (e.g. "claude-*" → anthropic)
    const providerHint = this.inferProviderFromModel(model);
    if (providerHint) {
      const entry = this.providers.get(providerHint);
      if (entry) {
        return { provider: entry.provider, model, providerName: providerHint };
      }
    }

    throw new Error(
      `No provider registered for model "${model}". ` +
      `Registered providers: ${[...this.providers.keys()].join(', ')}`,
    );
  }

  // -----------------------------------------------------------------------
  // Auto Routing (Task Complexity → Model)
  // -----------------------------------------------------------------------

  /**
   * Classify task complexity and auto-select the best available model.
   *
   * Falls back through the complexity routes until it finds a model
   * supported by a registered provider.
   *
   * @param task — The user's task description
   * @returns RouteResult with the selected provider and model
   */
  classifyAndRoute(task: string): RouteResult {
    const complexity = classifyTaskComplexity(task);

    // Try complexity-specific routes first
    const routes = this.complexityRoutes.filter((r) => r.complexity === complexity);
    for (const route of routes) {
      const entry = this.providers.get(route.providerName);
      if (entry && (entry.models.includes('*') || entry.models.includes(route.model))) {
        return { provider: entry.provider, model: route.model, providerName: route.providerName };
      }
    }

    // Fallback: try any model for this complexity across all providers
    for (const route of routes) {
      const entry = this.providers.get(route.providerName);
      if (entry) {
        // Use the provider's first available model
        const availableModel = entry.models.includes('*') ? route.model : entry.models[0] ?? route.model;
        return { provider: entry.provider, model: availableModel, providerName: route.providerName };
      }
    }

    // Last resort: first registered provider
    const firstEntry = [...this.providers.values()][0];
    if (!firstEntry) {
      throw new Error('No providers registered in the router');
    }
    const firstModel = firstEntry.models.includes('*')
      ? (complexity === 'complex' ? 'claude-opus-4-5' : complexity === 'medium' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5')
      : firstEntry.models[0] ?? '';
    return { provider: firstEntry.provider, model: firstModel, providerName: firstEntry.name };
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /**
   * List all registered providers.
   */
  listProviders(): string[] {
    return [...this.providers.keys()];
  }

  /**
   * List all available models across all registered providers.
   */
  async listAllModels(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];
    for (const [, entry] of this.providers) {
      try {
        const providerModels = await entry.provider.listModels();
        models.push(...providerModels);
      } catch {
        // Skip providers that fail to list models
      }
    }
    return models;
  }

  /**
   * Check if a model is supported by any registered provider.
   */
  supportsModel(model: string): boolean {
    for (const [, entry] of this.providers) {
      if (entry.models.includes('*') || entry.models.includes(model)) return true;
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Infer provider name from model name prefix.
   */
  private inferProviderFromModel(model: string): string | null {
    if (model.startsWith('claude-')) return 'anthropic';
    if (model.startsWith('gpt-') || model.startsWith('o1-') || model.startsWith('o3-')) return 'openai';
    if (model.startsWith('deepseek-')) return 'deepseek';
    if (model.startsWith('groq-') || model.startsWith('llama') || model.startsWith('mixtral')) return 'groq';
    return null;
  }
}

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

/**
 * Create a pre-configured ProviderRouter with Anthropic, OpenAI, and DeepSeek.
 *
 * @param configs — Map of provider name to ProviderConfig (apiKey required)
 * @param providers — Map of provider name to Provider constructor
 */
export function createDefaultRouter(
  configs: Record<string, ProviderConfig>,
  providers: Record<string, new (config: ProviderConfig) => Provider>,
): ProviderRouter {
  const router = new ProviderRouter();

  for (const [name, config] of Object.entries(configs)) {
    const ProviderClass = providers[name];
    if (ProviderClass && config.apiKey) {
      const instance = new ProviderClass(config);
      const models = name === 'anthropic'
        ? ['*'] // Anthropic handles all claude-* models
        : name === 'openai'
          ? ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo']
          : name === 'deepseek'
            ? ['deepseek-chat', 'deepseek-reasoner']
            : ['*'];
      router.register(name, instance, models);
    }
  }

  return router;
}
