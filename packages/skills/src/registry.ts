/**
 * registry.ts — SkillRegistry: in-memory skill index with disk persistence
 *
 * Map-based registry with singleton access. Loads skills from ~/.kode/skills/
 * via SkillLoader on init or reload(). Provides indexed lookups by tag and
 * trigger keyword, usage tracking, and improvement candidate detection.
 *
 * Architecture reference: ARCHITECTURE.md §4.11
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

export interface SkillRegistryEntry {
  skill: Skill;
  /** Index of this entry in the all[] array for O(1) lookup */
  _index: number;
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

  /**
   * Load all skills from disk and populate the registry.
   *
   * Call this once during initialization. Subsequent calls to reload()
   * will clear and re-scan.
   *
   * Returns the number of skills loaded.
   */
  loadFromDisk(): number {
    const skills = this.loader.loadAll();
    let count = 0;

    for (const skill of skills) {
      this.register(skill);
      count++;
    }

    return count;
  }

  /**
   * Clear the in-memory registry and re-scan the skills directory.
   * Useful after skills are created, edited, or deleted on disk.
   *
   * Returns the number of skills loaded after reload.
   */
  reload(): number {
    this.clear();
    return this.loadFromDisk();
  }

  // -------------------------------------------------------------------
  // Public: CRUD
  // -------------------------------------------------------------------

  /**
   * Register a skill in the registry and update all indices.
   *
   * If a skill with the same name already exists, it is replaced.
   */
  register(skill: Skill): void {
    const name = skill.metadata.name;

    // Remove old indices if replacing
    if (this.skills.has(name)) {
      this.removeFromIndices(this.skills.get(name)!);
    }

    this.skills.set(name, skill);
    this.addToIndices(skill);
  }

  /**
   * Remove a skill from the registry by name.
   * Returns true if the skill was found and removed.
   */
  unregister(skillName: string): boolean {
    const skill = this.skills.get(skillName);
    if (!skill) return false;

    this.removeFromIndices(skill);
    return this.skills.delete(skillName);
  }

  /**
   * Get a skill by its name (kebab-case identifier).
   */
  get(skillName: string): Skill | undefined {
    return this.skills.get(skillName);
  }

  /**
   * Get all registered skills.
   */
  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Return Progressive Disclosure summaries for all registered skills.
   *
   * These are the minimal name + description + triggers needed for
   * injection into the System Prompt.
   */
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

  /**
   * Find skills whose trigger keywords fuzzy-match the given keyword.
   * Uses the pre-built trigger index for O(1) lookup.
   *
   * Matching is case-insensitive substring matching.
   */
  findByTrigger(keyword: string): Skill[] {
    const lower = keyword.toLowerCase();
    const matchedNames = new Set<string>();

    // Search the trigger index
    for (const [trigger, names] of this.triggerIndex) {
      if (trigger.includes(lower)) {
        for (const name of names) {
          matchedNames.add(name);
        }
      }
    }

    // Also check for direct name match
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

  /**
   * Get all skills matching a specific tag.
   * Uses the pre-built tag index for O(1) lookup.
   */
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

  /**
   * Search skills by name or description text (full-scan).
   * Case-insensitive substring matching on name + description.
   */
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

  /**
   * Record that a skill was invoked. Increments usageCount and sets
   * lastUsedAt to now.
   */
  recordUsage(skillName: string): void {
    const skill = this.skills.get(skillName);
    if (!skill) return;

    skill.usageCount++;
    skill.lastUsedAt = new Date();
    this.totalUsages++;
  }

  /**
   * Get usage statistics across all skills.
   */
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

    // Sort by count descending
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

  /**
   * Identify skills that may need improvement.
   *
   * Criteria:
   *  - Skills that have been used many times (>10) but never updated
   *    (createdAt === updatedAt) may benefit from refinement.
   *  - Skills with no triggers defined (harder to discover).
   *  - Skills with very short descriptions (<20 chars).
   *
   * Returns a list of skill names with reasons.
   */
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

  /**
   * Get all unique tags across all registered skills.
   */
  getAllTags(): string[] {
    return Array.from(this.tagIndex.keys()).sort();
  }

  /**
   * Get all unique trigger keywords across all registered skills.
   */
  getAllTriggers(): string[] {
    return Array.from(this.triggerIndex.keys()).sort();
  }

  /**
   * Total number of registered skills.
   */
  get count(): number {
    return this.skills.size;
  }

  /**
   * Check whether a skill is registered.
   */
  has(skillName: string): boolean {
    return this.skills.has(skillName);
  }

  /**
   * Get the skills directory path.
   */
  getSkillsDir(): string {
    return this.loader.getSkillsDir();
  }

  // -------------------------------------------------------------------
  // Public: Lifecycle
  // -------------------------------------------------------------------

  /**
   * Clear all skills and indices from memory.
   * Does NOT delete files on disk.
   */
  clear(): void {
    this.skills.clear();
    this.tagIndex.clear();
    this.triggerIndex.clear();
    this.totalUsages = 0;
  }

  // -------------------------------------------------------------------
  // Private: Index management
  // -------------------------------------------------------------------

  /**
   * Add a skill to all lookup indices.
   */
  private addToIndices(skill: Skill): void {
    const name = skill.metadata.name;
    const tags = skill.metadata.tags ?? [];
    const triggers = skill.metadata.triggers ?? [];

    // Tag index
    for (const tag of tags) {
      const lower = tag.toLowerCase();
      let set = this.tagIndex.get(lower);
      if (!set) {
        set = new Set();
        this.tagIndex.set(lower, set);
      }
      set.add(name);
    }

    // Trigger index
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

  /**
   * Remove a skill from all lookup indices.
   */
  private removeFromIndices(skill: Skill): void {
    const name = skill.metadata.name;
    const tags = skill.metadata.tags ?? [];
    const triggers = skill.metadata.triggers ?? [];

    // Tag index
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

    // Trigger index
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

    // Subtract usage count from total
    this.totalUsages = Math.max(0, this.totalUsages - skill.usageCount);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: SkillRegistry | null = null;

/**
 * Get the shared SkillRegistry singleton.
 *
 * The first call creates the default instance pointed at ~/.kode/skills/.
 * Use setSkillRegistry() to inject a custom instance (e.g. for testing).
 */
export function getSkillRegistry(): SkillRegistry {
  if (!_instance) {
    _instance = new SkillRegistry();
  }
  return _instance;
}

/**
 * Inject a custom SkillRegistry instance (e.g. for testing with a temp dir).
 */
export function setSkillRegistry(registry: SkillRegistry): void {
  _instance = registry;
}

/**
 * Reset the singleton — clears memory and sets _instance to null.
 */
export function resetSkillRegistry(): void {
  if (_instance) {
    _instance.clear();
    _instance = null;
  }
}
