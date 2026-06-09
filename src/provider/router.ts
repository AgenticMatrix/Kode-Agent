/**
 * ProviderRouter — Multi-provider routing and task-to-model classification.
 *
 * Registers multiple providers with their supported models. Routes requests
 * to the appropriate provider based on the model name. Auto mode classifies
 * task complexity and selects the right model automatically.
 */

import type { Provider, ProviderConfig, ModelInfo } from './base.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskComplexity = 'simple' | 'medium' | 'complex';

export interface ProviderEntry {
  name: string;
  provider: Provider;
  models: string[];
}

export interface RouteResult {
  provider: Provider;
  model: string;
  providerName: string;
}

export interface ComplexityRoute {
  complexity: TaskComplexity;
  model: string;
  providerName: string;
}

// ---------------------------------------------------------------------------
// Default complexity routing table
// ---------------------------------------------------------------------------

const DEFAULT_COMPLEXITY_ROUTES: ComplexityRoute[] = [
  { complexity: 'simple', model: 'claude-haiku-4-5', providerName: 'anthropic' },
  { complexity: 'simple', model: 'deepseek-chat', providerName: 'deepseek' },
  { complexity: 'simple', model: 'gpt-4o-mini', providerName: 'openai' },

  { complexity: 'medium', model: 'claude-sonnet-4-6', providerName: 'anthropic' },
  { complexity: 'medium', model: 'deepseek-chat', providerName: 'deepseek' },
  { complexity: 'medium', model: 'gpt-4o', providerName: 'openai' },

  { complexity: 'complex', model: 'claude-opus-4-5', providerName: 'anthropic' },
  { complexity: 'complex', model: 'deepseek-reasoner', providerName: 'deepseek' },
  { complexity: 'complex', model: 'gpt-4o', providerName: 'openai' },
];

// ---------------------------------------------------------------------------
// Task Complexity Classification
// ---------------------------------------------------------------------------

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

export function classifyTaskComplexity(task: string): TaskComplexity {
  for (const { complexity, patterns } of COMPLEXITY_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(task)) {
        return complexity;
      }
    }
  }
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

  register(name: string, provider: Provider, models: string[]): void {
    this.providers.set(name, { name, provider, models });
  }

  setComplexityRoutes(routes: ComplexityRoute[]): void {
    this.complexityRoutes = routes;
  }

  // -----------------------------------------------------------------------
  // Model-based Routing
  // -----------------------------------------------------------------------

  selectProvider(model: string): RouteResult {
    for (const [name, entry] of this.providers) {
      if (entry.models.includes('*') || entry.models.includes(model)) {
        return { provider: entry.provider, model, providerName: name };
      }
    }

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

  classifyAndRoute(task: string): RouteResult {
    const complexity = classifyTaskComplexity(task);

    const routes = this.complexityRoutes.filter((r) => r.complexity === complexity);
    for (const route of routes) {
      const entry = this.providers.get(route.providerName);
      if (entry && (entry.models.includes('*') || entry.models.includes(route.model))) {
        return { provider: entry.provider, model: route.model, providerName: route.providerName };
      }
    }

    for (const route of routes) {
      const entry = this.providers.get(route.providerName);
      if (entry) {
        const availableModel = entry.models.includes('*') ? route.model : entry.models[0] ?? route.model;
        return { provider: entry.provider, model: availableModel, providerName: route.providerName };
      }
    }

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

  listProviders(): string[] {
    return [...this.providers.keys()];
  }

  async listAllModels(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];
    for (const [, entry] of this.providers) {
      try {
        const providerModels = await entry.provider.listModels();
        models.push(...providerModels);
      } catch { /* skip */ }
    }
    return models;
  }

  supportsModel(model: string): boolean {
    for (const [, entry] of this.providers) {
      if (entry.models.includes('*') || entry.models.includes(model)) return true;
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

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
        ? ['*']
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
