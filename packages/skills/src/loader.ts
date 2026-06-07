/**
 * loader.ts — SkillLoader: SKILL.md discovery, parsing, and Progressive Disclosure
 *
 * Scans ~/.coder/skills/ for <skill-name>/SKILL.md files, parses YAML
 * frontmatter + Markdown body, and exposes Progressive Disclosure
 * summaries (name + description + triggers only) for System Prompt injection.
 *
 * Architecture reference: ARCHITECTURE.md §4.11
 */

import { readFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

import type {
  Skill,
  SkillMetadata,
  SkillSummary,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SKILLS_DIR = join(homedir(), '.coder', 'skills');
const SKILL_FILE = 'SKILL.md';

// ---------------------------------------------------------------------------
// SkillLoader
// ---------------------------------------------------------------------------

export class SkillLoader {
  private skillsDir: string;

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir ?? DEFAULT_SKILLS_DIR;
    this.ensureDir();
  }

  // -------------------------------------------------------------------
  // Public: Scanning
  // -------------------------------------------------------------------

  /**
   * Scan the skills directory and return a list of skill names.
   *
   * Only directories containing a SKILL.md file are considered valid skills.
   */
  scan(): string[] {
    if (!existsSync(this.skillsDir)) return [];

    const names: string[] = [];

    try {
      const entries = readdirSync(this.skillsDir);
      for (const entry of entries) {
        const entryPath = join(this.skillsDir, entry);

        try {
          if (!statSync(entryPath).isDirectory()) continue;
        } catch {
          continue;
        }

        const skillFile = join(entryPath, SKILL_FILE);
        if (existsSync(skillFile)) {
          names.push(entry);
        }
      }
    } catch {
      // Directory unreadable — return empty
    }

    names.sort();
    return names;
  }

  // -------------------------------------------------------------------
  // Public: Loading
  // -------------------------------------------------------------------

  /**
   * Load and parse a single skill by name.
   * Returns null if the skill does not exist or is unparseable.
   */
  load(skillName: string): Skill | null {
    const filePath = join(this.skillsDir, skillName, SKILL_FILE);

    if (!existsSync(filePath)) return null;

    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }

    const metadata = this.parseFrontmatter(raw, filePath);
    if (!metadata) return null;

    const body = this.extractBody(raw);
    if (body === null) return null;

    return {
      metadata,
      body,
      path: filePath,
      usageCount: 0,
    };
  }

  /**
   * Load all skills from disk.
   */
  loadAll(): Skill[] {
    const names = this.scan();
    const skills: Skill[] = [];

    for (const name of names) {
      const skill = this.load(name);
      if (skill) {
        skills.push(skill);
      }
    }

    return skills;
  }

  // -------------------------------------------------------------------
  // Public: Progressive Disclosure
  // -------------------------------------------------------------------

  /**
   * Return Progressive Disclosure summaries for all loaded skills.
   *
   * Only includes name + description + triggers — the minimum needed
   * for the System Prompt so the LLM knows what skills are available.
   * The full body is only loaded when the Agent invokes the Skill tool.
   */
  getSummaries(): SkillSummary[] {
    const names = this.scan();
    const summaries: SkillSummary[] = [];

    for (const name of names) {
      const filePath = join(this.skillsDir, name, SKILL_FILE);

      let raw: string;
      try {
        raw = readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      const metadata = this.parseFrontmatter(raw, filePath);
      if (!metadata) continue;

      summaries.push({
        name: metadata.name,
        description: metadata.description,
        triggers: metadata.triggers ?? [],
      });
    }

    return summaries;
  }

  // -------------------------------------------------------------------
  // Public: Search
  // -------------------------------------------------------------------

  /**
   * Find skills whose trigger keywords match the given keyword.
   * Case-insensitive partial match on each trigger.
   */
  findByTrigger(keyword: string): Skill[] {
    const all = this.loadAll();
    const lower = keyword.toLowerCase();

    return all.filter((skill) =>
      (skill.metadata.triggers ?? []).some((t) =>
        t.toLowerCase().includes(lower),
      ),
    );
  }

  /**
   * Get the skills directory path.
   */
  getSkillsDir(): string {
    return this.skillsDir;
  }

  // -------------------------------------------------------------------
  // Private: Frontmatter Parsing
  // -------------------------------------------------------------------

  /**
   * Parse YAML frontmatter from a SKILL.md string.
   *
   * Frontmatter is delimited by --- lines. The first --- must be at
   * the very start of the file (line 1). The second --- closes the
   * frontmatter section.
   *
   * Supported YAML subset (hand-written parser, no js-yaml dependency):
   *   key: value
   *   key: "value with spaces"
   *   key: [item1, item2]
   *   # comment line (ignored)
   */
  private parseFrontmatter(raw: string, _filePath: string): SkillMetadata | null {
    const lines = raw.split('\n');

    // Must start with ---
    if (lines.length === 0 || lines[0]!.trim() !== '---') {
      return null;
    }

    // Find closing ---
    let endIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]!.trim() === '---') {
        endIdx = i;
        break;
      }
    }

    if (endIdx === -1) return null;

    // Extract frontmatter lines (between the two ---)
    const fmLines = lines.slice(1, endIdx);
    const kv = this.parseYamlLines(fmLines);
    if (!kv) return null;

    const now = new Date().toISOString();

    // Build metadata with defaults
    const metadata: SkillMetadata = {
      name: (kv['name'] as string) ?? '',
      description: (kv['description'] as string) ?? '',
      version: kv['version'] as string | undefined,
      triggers: this.parseStringArray(kv['triggers']),
      tools: this.parseStringArray(kv['tools']),
      model: kv['model'] as string | undefined,
      tags: this.parseStringArray(kv['tags']),
      author: kv['author'] as string | undefined,
      createdAt: (kv['createdAt'] as string) ?? now,
      updatedAt: (kv['updatedAt'] as string) ?? now,
    };

    // name and description are required
    if (!metadata.name || !metadata.description) {
      return null;
    }

    return metadata;
  }

  /**
   * Parse a minimal YAML key-value mapping from lines.
   * Returns a Record<string, unknown> or null on parse failure.
   */
  private parseYamlLines(lines: string[]): Record<string, unknown> | null {
    const result: Record<string, unknown> = {};

    for (const rawLine of lines) {
      const line = rawLine.trim();

      // Skip empty lines and comments
      if (line === '' || line.startsWith('#')) continue;

      // Match: key: value
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const key = line.slice(0, colonIdx).trim();
      const valueRaw = line.slice(colonIdx + 1).trim();

      if (!key) continue;

      result[key] = this.parseYamlValue(valueRaw);
    }

    return Object.keys(result).length > 0 ? result : null;
  }

  /**
   * Parse a single YAML value.
   *
   * Supports:
   *   - Bare strings: value, some text here
   *   - Quoted strings: "value with spaces" or 'value with spaces'
   *   - Arrays: [item1, item2, item3]
   *   - Empty: (returns empty string)
   */
  private parseYamlValue(raw: string): unknown {
    if (raw === '') return '';

    // Array: [item1, item2]
    if (raw.startsWith('[') && raw.endsWith(']')) {
      const inner = raw.slice(1, -1).trim();
      if (inner === '') return [];
      return inner.split(',').map((s) => this.unquote(s.trim()));
    }

    // Quoted string
    if ((raw.startsWith('"') && raw.endsWith('"')) ||
        (raw.startsWith("'") && raw.endsWith("'"))) {
      return raw.slice(1, -1);
    }

    // Integer
    if (/^-?\d+$/.test(raw)) {
      return parseInt(raw, 10);
    }

    // Float
    if (/^-?\d+\.\d+$/.test(raw)) {
      return parseFloat(raw);
    }

    // Boolean
    if (raw === 'true') return true;
    if (raw === 'false') return false;

    // Null
    if (raw === 'null' || raw === '~') return null;

    // Bare string
    return raw;
  }

  /**
   * Remove surrounding quotes from a string value.
   */
  private unquote(s: string): string {
    if ((s.startsWith('"') && s.endsWith('"')) ||
        (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1);
    }
    return s;
  }

  /**
   * Parse a value that can be a string array or a single string.
   */
  private parseStringArray(value: unknown): string[] | undefined {
    if (Array.isArray(value)) {
      return value.map((v) => String(v));
    }
    if (typeof value === 'string' && value !== '') {
      return [value];
    }
    return undefined;
  }

  // -------------------------------------------------------------------
  // Private: Body Extraction
  // -------------------------------------------------------------------

  /**
   * Extract the Markdown body from SKILL.md (everything after the
   * closing --- of the frontmatter).
   */
  private extractBody(raw: string): string | null {
    const lines = raw.split('\n');

    // Must start with ---
    if (lines.length === 0 || lines[0]!.trim() !== '---') {
      return null;
    }

    // Find closing ---
    let endIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]!.trim() === '---') {
        endIdx = i;
        break;
      }
    }

    if (endIdx === -1) return null;

    // Body is everything after the closing ---
    const bodyLines = lines.slice(endIdx + 1);

    // Trim leading and trailing blank lines
    while (bodyLines.length > 0 && bodyLines[0]!.trim() === '') {
      bodyLines.shift();
    }
    while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1]!.trim() === '') {
      bodyLines.pop();
    }

    return bodyLines.join('\n');
  }

  // -------------------------------------------------------------------
  // Private: Helpers
  // -------------------------------------------------------------------

  /**
   * Ensure the skills directory exists.
   */
  private ensureDir(): void {
    if (!existsSync(this.skillsDir)) {
      mkdirSync(this.skillsDir, { recursive: true });
    }
  }
}
