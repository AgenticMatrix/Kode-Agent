/**
 * rules-manager.ts — Path-scoped rules system (Phase 5 Sprint 7)
 *
 * Scans .kode/rules/*.md files, extracts YAML frontmatter with optional
 * pathPattern glob, and returns only rules whose glob matches the currently
 * active file path. Matches .kode/rules/*.md pattern for auto-loading rules by file path.
 *
 * Rule file format:
 *   ---
 *   pathPattern: "src/frontend/**\/*.tsx"
 *   description: "React frontend conventions"
 *   ---
 *   # Frontend Rules
 *   - Use React 18+ hooks
 *   - TypeScript strict mode
 *
 * Architecture reference: CLAUDE_CODE_COMPARISON.md §二 (System Prompt 差距)
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single parsed rule file.
 */
export interface RuleFile {
  /** Absolute path to the rule file */
  path: string;
  /** Relative path from project root (for display) */
  relativePath: string;
  /** Glob pattern from frontmatter (e.g. "src/frontend/**\/*.tsx") */
  pathPattern?: string;
  /** Human-readable description of the rule */
  description?: string;
  /** The Markdown body (frontmatter stripped) */
  content: string;
  /** If true, the rule has no pathPattern and always loads */
  alwaysLoad: boolean;
}

/**
 * Context passed to getMatchingRules to determine which rules apply.
 */
export interface ActiveRulesContext {
  /** Project working directory */
  cwd: string;
  /** Currently active tool being invoked (e.g. 'Read', 'Write', 'Edit') */
  currentToolName?: string;
  /** Absolute path of the file currently being operated on */
  currentFilePath?: string;
  /**
   * Additional file paths being operated on (e.g. Edit tool's
   * old_path + new_path). All paths are checked against each rule's
   * pathPattern.
   */
  additionalPaths?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Directory name containing rule files */
const RULES_DIR = '.kode/rules';

/** Maximum individual rule file size (50 KB) */
const MAX_RULE_SIZE_BYTES = 50 * 1024;

// ---------------------------------------------------------------------------
// RuleManager
// ---------------------------------------------------------------------------

export class RuleManager {
  /** Loaded and parsed rules, keyed by project root path */
  private rulesByProject = new Map<string, RuleFile[]>();

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Scan the .kode/rules/ directory under cwd and parse all .md files.
   *
   * Results are cached per project root. Call this once at session start
   * or on tool invocation. Subsequent calls return the cached rules.
   *
   * @param cwd — Project working directory (used to locate .kode/rules/)
   * @returns Array of parsed RuleFile objects (may be empty if no rules dir)
   */
  loadRules(cwd: string): RuleFile[] {
    const rulesDir = resolve(cwd, RULES_DIR);

    // Return cached if already loaded for this project
    const cached = this.rulesByProject.get(rulesDir);
    if (cached) return cached;

    if (!existsSync(rulesDir)) {
      // Cache empty result so we don't re-check the filesystem
      this.rulesByProject.set(rulesDir, []);
      return [];
    }

    const rules: RuleFile[] = [];

    try {
      const entries = readdirSync(rulesDir);
      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue;

        const fullPath = join(rulesDir, entry);
        try {
          const st = statSync(fullPath);
          if (!st.isFile()) continue;
          if (st.size > MAX_RULE_SIZE_BYTES) continue;
        } catch {
          continue; // stat failed (permissions, deleted) — skip
        }

        try {
          const rawContent = readFileSync(fullPath, 'utf-8');
          const { frontmatter, body } = this.parseFrontmatter(rawContent);

          const pathPattern = frontmatter.pathPattern || frontmatter.pathpattern || frontmatter.glob;
          const description = frontmatter.description;

          rules.push({
            path: fullPath,
            relativePath: relative(cwd, fullPath),
            pathPattern,
            description,
            content: body.trim(),
            alwaysLoad: !pathPattern,
          });
        } catch {
          // Corrupt or unreadable rule file — skip
        }
      }
    } catch {
      // readdir failed (permissions) — return empty
    }

    // Sort: always-load rules first, then by relative path for determinism
    rules.sort((a, b) => {
      if (a.alwaysLoad !== b.alwaysLoad) return a.alwaysLoad ? -1 : 1;
      return a.relativePath.localeCompare(b.relativePath);
    });

    this.rulesByProject.set(rulesDir, rules);
    return rules;
  }

  /**
   * Get rules matching the current context.
   *
   * A rule matches if:
   *   1. It has alwaysLoad=true (no pathPattern), OR
   *   2. Its pathPattern glob matches any of the active file paths
   *      (currentFilePath + additionalPaths)
   *
   * @param ctx — Active context with current tool and file paths
   * @returns Array of matching RuleFile objects
   */
  getMatchingRules(ctx: ActiveRulesContext): RuleFile[] {
    const allRules = this.loadRules(ctx.cwd);
    if (allRules.length === 0) return [];

    // Collect all file paths to check
    const pathsToCheck: string[] = [];
    if (ctx.currentFilePath) {
      pathsToCheck.push(ctx.currentFilePath);
    }
    if (ctx.additionalPaths && ctx.additionalPaths.length > 0) {
      pathsToCheck.push(...ctx.additionalPaths);
    }

    // If no file paths at all, only return always-load rules
    if (pathsToCheck.length === 0) {
      return allRules.filter((r) => r.alwaysLoad);
    }

    // Compute the relative version of each path for glob matching
    const cwd = ctx.cwd;
    const relativePaths = pathsToCheck.map((p) => {
      try {
        return relative(cwd, p);
      } catch {
        return p; // fallback to absolute
      }
    });

    return allRules.filter((rule) => {
      // Always-load rules always match
      if (rule.alwaysLoad) return true;

      // Path-scoped rules: check if any active path matches the glob
      if (rule.pathPattern) {
        for (const rp of relativePaths) {
          if (this.matchGlob(rule.pathPattern, rp)) return true;
        }
      }

      return false;
    });
  }

  /**
   * Format matching rules for system prompt injection.
   *
   * @param rules — Matching rules from getMatchingRules()
   * @returns Formatted string ready for system prompt assembly
   */
  formatRulesForPrompt(rules: RuleFile[]): string {
    if (rules.length === 0) return '';

    const header = '## Project Rules';
    const sections = rules.map((rule) => {
      const desc = rule.description ? ` (${rule.description})` : '';
      const scope = rule.alwaysLoad ? '[always]' : `[scope: \`${rule.pathPattern}\`]`;
      return `### ${rule.relativePath} ${scope}${desc}\n${rule.content}`;
    });

    return [header, ...sections].join('\n\n');
  }

  /**
   * Clear the cache for a specific project (or all if cwd omitted).
   * Useful for testing and for reloading rules after file changes.
   */
  clearCache(cwd?: string): void {
    if (cwd) {
      const rulesDir = resolve(cwd, RULES_DIR);
      this.rulesByProject.delete(rulesDir);
    } else {
      this.rulesByProject.clear();
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Frontmatter Parsing
  // ---------------------------------------------------------------------------

  /**
   * Parse YAML-like frontmatter from a Markdown file.
   *
   * Frontmatter is delimited by --- at the start and end of the block.
   * Only key: "value" pairs are supported (no nested YAML structures).
   *
   * @param content — Raw file content
   * @returns Parsed frontmatter key-value pairs and remaining body text
   */
  private parseFrontmatter(content: string): {
    frontmatter: Record<string, string>;
    body: string;
  } {
    const frontmatter: Record<string, string> = {};

    // Match frontmatter block: starts with --- at line start, ends with ---
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    if (!match) {
      return { frontmatter, body: content };
    }

    const fmBlock = match[1]!;
    const body = content.slice(match[0].length);

    // Parse simple key: "value" lines
    for (const line of fmBlock.split('\n')) {
      const kvMatch = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*["']?(.+?)["']?\s*$/);
      if (kvMatch) {
        const key = kvMatch[1]!;
        let value = kvMatch[2]!;
        // Strip trailing quotes if they exist
        value = value.replace(/^["']|["']$/g, '');
        frontmatter[key] = value;
      }
    }

    return { frontmatter, body };
  }

  // ---------------------------------------------------------------------------
  // Private: Glob Matching
  // ---------------------------------------------------------------------------

  /**
   * Check whether a relative file path matches a glob pattern.
   *
   * Supported glob features:
   *   ** — matches zero or more directory segments
   *   *  — matches zero or more characters within a segment (except /)
   *   ?  — matches exactly one character within a segment (except /)
   *   {a,b} — alternation (matches a or b)
   *   [...] — character class
   *
   * This is a lightweight implementation that avoids the minimatch dependency.
   *
   * @param pattern — Glob pattern (e.g. "src/frontend/**\/*.tsx")
   * @param filePath — Relative file path to check
   * @returns true if the file path matches the pattern
   */
  matchGlob(pattern: string, filePath: string): boolean {
    // Normalize to forward slashes for cross-platform matching
    const normPattern = pattern.replace(/\\/g, '/');
    const normPath = filePath.replace(/\\/g, '/');

    try {
      const regex = this.globToRegex(normPattern);
      return regex.test(normPath);
    } catch {
      // If regex construction fails, fall back to simple string match
      return normPath.includes(normPattern.replace(/\*\*/g, ''));
    }
  }

  /**
   * Convert a glob pattern to a regular expression.
   *
   * Conversion rules:
   *   **[/]  → (.*[/])?  (match zero+ directory segments)
   *   *      → [^/]*      (match within a single segment)
   *   ?      → [^/]       (single character)
   *   {a,b}  → (a|b)
   *   [...]  — passed through as-is (character class)
   *   . + ^ $ ( ) | — escaped
   *
   * @param pattern — Glob pattern string
   * @returns Compiled RegExp
   */
  private globToRegex(pattern: string): RegExp {
    let regexStr = '';
    let i = 0;

    while (i < pattern.length) {
      const ch = pattern[i];

      switch (ch) {
        case '\\': {
          // Escaped character — pass through literally
          i++;
          if (i < pattern.length) {
            regexStr += escapeRegExp(pattern[i]!);
          }
          i++;
          break;
        }
        case '*': {
          // Check for ** (double star = cross-directory)
          if (pattern[i + 1] === '*' && (pattern[i + 2] === '/' || pattern[i + 2] === undefined)) {
            // ** or **/  → match zero or more directory segments
            regexStr += '(?:.*/)?';
            i += 2;
            if (pattern[i] === '/') i++; // skip trailing /
          } else {
            // Single * → match within segment
            regexStr += '[^/]*';
            i++;
          }
          break;
        }
        case '?': {
          regexStr += '[^/]';
          i++;
          break;
        }
        case '{': {
          // Alternation: {a,b,c}
          const closing = pattern.indexOf('}', i);
          if (closing === -1) {
            regexStr += '\\{';
            i++;
          } else {
            const inner = pattern.slice(i + 1, closing);
            const options = inner.split(',').map((o) => o.trim());
            regexStr += `(${options.map(escapeRegExp).join('|')})`;
            i = closing + 1;
          }
          break;
        }
        case '[': {
          // Character class: pass through
          const closing = pattern.indexOf(']', i);
          if (closing === -1) {
            regexStr += '\\[';
            i++;
          } else {
            regexStr += pattern.slice(i, closing + 1);
            i = closing + 1;
          }
          break;
        }
        case '.':
        case '+':
        case '^':
        case '$':
        case '(':
        case ')':
        case '|':
        case '/': {
          // Escape regex special chars (but `/` is literal in paths)
          regexStr += ch === '/' ? '\\/' : `\\${ch}`;
          i++;
          break;
        }
        default: {
          regexStr += ch;
          i++;
        }
      }
    }

    // Anchor: must match the entire path
    return new RegExp(`^${regexStr}$`);
  }
}

// ---------------------------------------------------------------------------
// Helper: escape string for RegExp
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
