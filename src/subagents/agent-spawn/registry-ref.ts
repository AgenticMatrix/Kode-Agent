import type { SubAgentRegistry } from '../../core/subagent-registry.js';

let _registry: SubAgentRegistry | null = null;

export function setSubAgentRegistry(registry: SubAgentRegistry): void {
  _registry = registry;
}

export function getSubAgentRegistry(): SubAgentRegistry | null {
  return _registry;
}
