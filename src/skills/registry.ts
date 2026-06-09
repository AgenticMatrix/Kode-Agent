/**
 * registry.ts — SkillRegistry: in-memory skill index with disk persistence
 *
 * Map-based registry with singleton access. Loads skills from ~/.coder/skills/
 * via SkillLoader on init or reload(). Provides indexed lookups by tag and
 * trigger keyword, usage tracking, and improvement candidate detection.
 */

import type {
  Skill,
  SkillSummary,
  SkillImprovementSuggestion,
} from './types.js';
import { SkillLoader } from './loader.js';

// ---------------------------------------------------------------------------
// Utility types
// ---------------------------------------------------------------------------

export interface SkillUsageStats {
  totalSkills: number;
  totalUsages: number;
  mostUsed: Array<{ name: string; count: number }>;
  leastUsed: string[];
  unused: string[];
}

// ---------------------------------------------------------------------------
// SkillRegistry
// ---------------------------------------------------------------------------

export class SkillRegistry {
  /** Primary storage: skill name → Skill */
  private skills = new Map<string, Skill>();

  /** Tag index: tag → Set<skill name> for O(1) tag lookups */
  private tagIndex = new Map<string, Set<string>>();

  /** Trigger index: lowercase trigger keyword → Set<skill name> */
  private triggerIndex = new Map<string, Set<string>>();

  /** Total invocation count across all skills */
  private totalUsages = 0;

  private loader: SkillLoader;

  constructor(skillsDir?: string) {
    this.loader = new SkillLoader(skillsDir);
  }

  // -------------------------------------------------------------------
  // Public: Disk loading
  // -------------------------------------------------------------------

  loadFromDisk(): number {
    const skills = this.loader.loadAll();
    let count = 0;

    for (const skill of skills) {
      this.register(skill);
      count++;
    }

    return count;
  }

  reload(): number {
    this.clear();
    return this.loadFromDisk();
  }

  // -------------------------------------------------------------------
  // Public: CRUD
  // -------------------------------------------------------------------

  register(skill: Skill): void {
    const name = skill.metadata.name;

    if (this.skills.has(name)) {
      this.removeFromIndices(this.skills.get(name)!);
    }

    this.skills.set(name, skill);
    this.addToIndices(skill);
  }

  unregister(skillName: string): boolean {
    const skill = this.skills.get(skillName);
    if (!skill) return false;

    this.removeFromIndices(skill);
    return this.skills.delete(skillName);
  }

  get(skillName: string): Skill | undefined {
    return this.skills.get(skillName);
  }

  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  getSummaries(): SkillSummary[] {
    const summaries: SkillSummary[] = [];

    for (const [, skill] of this.skills) {
      summaries.push({
        name: skill.metadata.name,
        description: skill.metadata.description,
        triggers: skill.metadata.triggers ?? [],
      });
    }

    return summaries;
  }

  // -------------------------------------------------------------------
  // Public: Search & Lookup
  // -------------------------------------------------------------------

  findByTrigger(keyword: string): Skill[] {
    const lower = keyword.toLowerCase();
    const matchedNames = new Set<string>();

    for (const [trigger, names] of this.triggerIndex) {
      if (trigger.includes(lower)) {
        for (const name of names) {
          matchedNames.add(name);
        }
      }
    }

    for (const [name] of this.skills) {
      if (name.toLowerCase().includes(lower)) {
        matchedNames.add(name);
      }
    }

    const results: Skill[] = [];
    for (const name of matchedNames) {
      const skill = this.skills.get(name);
      if (skill) results.push(skill);
    }

    return results;
  }

  getByTag(tag: string): Skill[] {
    const names = this.tagIndex.get(tag.toLowerCase());
    if (!names || names.size === 0) return [];

    const results: Skill[] = [];
    for (const name of names) {
      const skill = this.skills.get(name);
      if (skill) results.push(skill);
    }

    return results;
  }

  search(query: string): Skill[] {
    const lower = query.toLowerCase();
    if (!lower) return this.getAll();

    const results: Skill[] = [];

    for (const [, skill] of this.skills) {
      const nameMatch = skill.metadata.name.toLowerCase().includes(lower);
      const descMatch = skill.metadata.description.toLowerCase().includes(lower);
      if (nameMatch || descMatch) {
        results.push(skill);
      }
    }

    return results;
  }

  // -------------------------------------------------------------------
  // Public: Usage Tracking
  // -------------------------------------------------------------------

  recordUsage(skillName: string): void {
    const skill = this.skills.get(skillName);
    if (!skill) return;

    skill.usageCount++;
    skill.lastUsedAt = new Date();
    this.totalUsages++;
  }

  getUsageStats(): SkillUsageStats {
    const all = this.getAll();
    const unused: string[] = [];
    const entries: Array<{ name: string; count: number }> = [];

    for (const skill of all) {
      if (skill.usageCount === 0) {
        unused.push(skill.metadata.name);
      }
      entries.push({ name: skill.metadata.name, count: skill.usageCount });
    }

    entries.sort((a, b) => b.count - a.count);

    const mostUsed = entries.filter((e) => e.count > 0).slice(0, 10);
    const leastUsed = entries
      .filter((e) => e.count > 0)
      .slice(-5)
      .map((e) => e.name);

    return {
      totalSkills: all.length,
      totalUsages: this.totalUsages,
      mostUsed,
      leastUsed,
      unused,
    };
  }

  // -------------------------------------------------------------------
  // Public: Improvement Candidates
  // -------------------------------------------------------------------

  getImprovementCandidates(): SkillImprovementSuggestion[] {
    const suggestions: SkillImprovementSuggestion[] = [];
    const now = new Date();

    for (const [, skill] of this.skills) {
      const meta = skill.metadata;

      // High usage + no updates since creation
      if (
        skill.usageCount > 10 &&
        meta.createdAt === meta.updatedAt
      ) {
        suggestions.push({
          field: 'steps' as const,
          current: 'Original steps from creation',
          suggested: 'Consider refining steps based on observed usage patterns',
          reason: `"${meta.name}" has been used ${skill.usageCount} times without any updates since creation`,
        });
      }

      // Missing triggers
      if (!meta.triggers || meta.triggers.length === 0) {
        suggestions.push({
          field: 'triggers' as const,
          current: '(none)',
          suggested: 'Add trigger keywords to improve discoverability',
          reason: `"${meta.name}" has no trigger keywords — it cannot be auto-discovered`,
        });
      }

      // Short description
      if (meta.description.length < 20) {
        suggestions.push({
          field: 'description' as const,
          current: meta.description,
          suggested: 'Expand the description to be more specific',
          reason: `"${meta.name}" has a very short description (${meta.description.length} chars)`,
        });
      }

      // Stale skills — last used > 90 days ago and has > 0 usages
      if (skill.lastUsedAt && skill.usageCount > 0) {
        const daysSinceUse =
          (now.getTime() - skill.lastUsedAt.getTime()) / (24 * 60 * 60 * 1000);
        if (daysSinceUse > 90) {
          suggestions.push({
            field: 'triggers' as const,
            current: meta.triggers?.join(', ') ?? '(none)',
            suggested: 'Consider updating triggers to match current usage patterns',
            reason: `"${meta.name}" hasn't been used in ${Math.round(daysSinceUse)} days`,
          });
        }
      }
    }

    return suggestions;
  }

  // -------------------------------------------------------------------
  // Public: Introspection
  // -------------------------------------------------------------------

  getAllTags(): string[] {
    return Array.from(this.tagIndex.keys()).sort();
  }

  getAllTriggers(): string[] {
    return Array.from(this.triggerIndex.keys()).sort();
  }

  get count(): number {
    return this.skills.size;
  }

  has(skillName: string): boolean {
    return this.skills.has(skillName);
  }

  getSkillsDir(): string {
    return this.loader.getSkillsDir();
  }

  // -------------------------------------------------------------------
  // Public: Lifecycle
  // -------------------------------------------------------------------

  clear(): void {
    this.skills.clear();
    this.tagIndex.clear();
    this.triggerIndex.clear();
    this.totalUsages = 0;
  }

  // -------------------------------------------------------------------
  // Private: Index management
  // -------------------------------------------------------------------

  private addToIndices(skill: Skill): void {
    const name = skill.metadata.name;
    const tags = skill.metadata.tags ?? [];
    const triggers = skill.metadata.triggers ?? [];

    for (const tag of tags) {
      const lower = tag.toLowerCase();
      let set = this.tagIndex.get(lower);
      if (!set) {
        set = new Set();
        this.tagIndex.set(lower, set);
      }
      set.add(name);
    }

    for (const trigger of triggers) {
      const lower = trigger.toLowerCase();
      let set = this.triggerIndex.get(lower);
      if (!set) {
        set = new Set();
        this.triggerIndex.set(lower, set);
      }
      set.add(name);
    }
  }

  private removeFromIndices(skill: Skill): void {
    const name = skill.metadata.name;
    const tags = skill.metadata.tags ?? [];
    const triggers = skill.metadata.triggers ?? [];

    for (const tag of tags) {
      const lower = tag.toLowerCase();
      const set = this.tagIndex.get(lower);
      if (set) {
        set.delete(name);
        if (set.size === 0) {
          this.tagIndex.delete(lower);
        }
      }
    }

    for (const trigger of triggers) {
      const lower = trigger.toLowerCase();
      const set = this.triggerIndex.get(lower);
      if (set) {
        set.delete(name);
        if (set.size === 0) {
          this.triggerIndex.delete(lower);
        }
      }
    }

    this.totalUsages = Math.max(0, this.totalUsages - skill.usageCount);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: SkillRegistry | null = null;

export function getSkillRegistry(): SkillRegistry {
  if (!_instance) {
    _instance = new SkillRegistry();
  }
  return _instance;
}

export function setSkillRegistry(registry: SkillRegistry): void {
  _instance = registry;
}

export function resetSkillRegistry(): void {
  if (_instance) {
    _instance.clear();
    _instance = null;
  }
}
