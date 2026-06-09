/**
 * types.ts — Skills system shared types
 */

// ---------------------------------------------------------------------------
// Skill Metadata (parsed from SKILL.md YAML frontmatter)
// ---------------------------------------------------------------------------

export interface SkillMetadata {
  /** Unique skill identifier (kebab-case) */
  name: string;
  /** One-line description for Progressive Disclosure in System Prompt */
  description: string;
  /** Semantic version */
  version?: string;
  /** Keywords that trigger this skill */
  triggers?: string[];
  /** Tools required by this skill */
  tools?: string[];
  /** Recommended model for this skill */
  model?: string;
  /** Categorization tags */
  tags?: string[];
  /** Author — "auto" for auto-created skills */
  author?: string;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last update */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Skill (fully parsed from SKILL.md)
// ---------------------------------------------------------------------------

export interface Skill {
  /** Parsed frontmatter metadata */
  metadata: SkillMetadata;
  /** Full Markdown body (steps, instructions, examples) */
  body: string;
  /** Absolute path to the SKILL.md file */
  path: string;
  /** How many times this skill has been invoked */
  usageCount: number;
  /** When this skill was last used */
  lastUsedAt?: Date;
}

// ---------------------------------------------------------------------------
// Skill Summary (Progressive Disclosure — injected into System Prompt)
// ---------------------------------------------------------------------------

export interface SkillSummary {
  name: string;
  description: string;
  triggers: string[];
}

// ---------------------------------------------------------------------------
// Skill Creation Candidate (from task tracking)
// ---------------------------------------------------------------------------

export interface SkillCreationCandidate {
  /** Human-readable task description */
  taskDescription: string;
  /** Complexity score 0-1 */
  complexity: number;
  /** How many times this task pattern has been seen */
  repeatCount: number;
  /** Steps the agent took to complete the task */
  steps: string[];
  /** Tools used during execution */
  toolsUsed: string[];
}

// ---------------------------------------------------------------------------
// Skill Improvement Suggestion (from post-execution analysis)
// ---------------------------------------------------------------------------

export interface SkillImprovementSuggestion {
  /** Which section of the skill to improve */
  field: 'steps' | 'description' | 'triggers' | 'tools' | 'edge_cases';
  /** Current text / value */
  current: string;
  /** Suggested replacement */
  suggested: string;
  /** Why this improvement is recommended */
  reason: string;
}

// ---------------------------------------------------------------------------
// LLM Call Function (injected dependency for creator / improver)
// ---------------------------------------------------------------------------

export type CallModelFn = (params: {
  system: string;
  messages: Array<{ role: string; content: string }>;
  tools: unknown[];
  signal: AbortSignal;
}) => AsyncGenerator<unknown>;
