/**
 * @kode/skills — Kode Agent Skills System
 *
 * SKILL.md discovery, Progressive Disclosure, and self-evolution.
 * Architecture reference: ARCHITECTURE.md §4.11
 */

export { SkillLoader } from './loader.js';
export {
  SkillRegistry,
  getSkillRegistry,
  setSkillRegistry,
  resetSkillRegistry,
} from './registry.js';
export type { SkillUsageStats } from './registry.js';
export { SkillCreator } from './creator.js';
export { SkillImprover } from './improver.js';
export type { SkillExecutionResult } from './improver.js';
export type {
  SkillMetadata,
  Skill,
  SkillSummary,
  SkillCreationCandidate,
  SkillImprovementSuggestion,
} from './types.js';
