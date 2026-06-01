/**
 * creator.ts — SkillCreator: LLM-driven skill creation from task patterns
 *
 * Detects repeated task patterns in the agent's activity log, proposes
 * skill creation via LLM draft generation, and writes SKILL.md files.
 *
 * Flow:
 *  1. trackTask() — record each task execution to ~/.kode/skills/.task-patterns.json
 *  2. shouldCreateSkill() — check if pattern repeats enough (≥2) or is complex enough
 *  3. generateDraft() → proposeSkill() — LLM generates SKILL.md draft
 *  4. writeSkill() — atomic write to ~/.kode/skills/<name>/SKILL.md
 *
 * Architecture reference: ARCHITECTURE.md §4.11, SPRINT_PLAN.md §5.9
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

import type {
  Skill,
  SkillMetadata,
  SkillCreationCandidate,
} from './types.js';
import { SkillLoader } from './loader.js';

// ---------------------------------------------------------------------------
// AsyncGenerator type alias (avoid circular dep on @kode/core)
// ---------------------------------------------------------------------------

type CallModelFn = (params: {
  system: string;
  messages: Array<{ role: string; content: string }>;
  tools: unknown[];
  signal: AbortSignal;
}) => AsyncGenerator<unknown>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SKILLS_DIR = join(homedir(), '.kode', 'skills');
const TASK_PATTERNS_FILE = '.task-patterns.json';
const MIN_REPEAT_COUNT = 2;
const MIN_COMPLEXITY = 0.6;

interface TaskPatternEntry {
  count: number;
  tools: string[];
  lastSeen: string; // ISO timestamp
  steps: string[];
  description: string;
}

interface TaskPatternsStore {
  patterns: Record<string, TaskPatternEntry>;
}

// ---------------------------------------------------------------------------
// SkillCreator
// ---------------------------------------------------------------------------

export class SkillCreator {
  private callModel: CallModelFn;
  private skillsDir: string;
  private loader: SkillLoader;

  constructor(config: {
    callModel: CallModelFn;
    skillsDir?: string;
  }) {
    this.callModel = config.callModel;
    this.skillsDir = config.skillsDir ?? DEFAULT_SKILLS_DIR;
    this.loader = new SkillLoader(this.skillsDir);
  }

  // ── Pattern Detection ───────────────────────────────────────────

  /**
   * Determine whether a task pattern should trigger skill creation.
   *
   * Rules:
   *   - repeatCount >= 2: pattern has been seen enough times
   *   - complexity >= 0.6: task is inherently complex enough
   */
  shouldCreateSkill(candidate: SkillCreationCandidate): boolean {
    return candidate.repeatCount >= MIN_REPEAT_COUNT ||
           candidate.complexity >= MIN_COMPLEXITY;
  }

  // ── Draft Generation ────────────────────────────────────────────

  /**
   * Generate a SKILL.md draft via LLM.
   *
   * The LLM receives the task description, steps, and tools used, and
   * is asked to produce a complete SKILL.md with YAML frontmatter and
   * Markdown body.
   *
   * @returns The generated SKILL.md content as a string.
   */
  async generateDraft(candidate: SkillCreationCandidate): Promise<string> {
    const systemPrompt = this.buildDraftSystemPrompt();
    const userPrompt = this.buildDraftUserPrompt(candidate);

    let fullResponse = '';

    const signal = new AbortController().signal;
    const generator = this.callModel({
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      tools: [],
      signal,
    });

    for await (const event of generator) {
      const ev = event as Record<string, unknown>;

      // Stream events
      if (ev.type === 'content_block_delta' && ev.delta) {
        const delta = ev.delta as Record<string, unknown>;
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          fullResponse += delta.text;
        }
      }

      // Direct assistant message (provider-adapter path)
      if (ev.role === 'assistant' && ev.content) {
        if (typeof ev.content === 'string') {
          fullResponse = ev.content;
        } else if (Array.isArray(ev.content)) {
          fullResponse = (ev.content as Array<Record<string, unknown>>)
            .filter((b) => b.type === 'text')
            .map((b) => String(b.text ?? ''))
            .join('\n');
        }
      }
    }

    return this.cleanDraft(fullResponse);
  }

  /**
   * Propose a skill: generate draft + return structured info for TUI
   * confirmation dialog.
   */
  async proposeSkill(candidate: SkillCreationCandidate): Promise<{
    name: string;
    draft: string;
    reason: string;
  }> {
    const draft = await this.generateDraft(candidate);
    const name = this.extractSkillName(draft) ?? this.generateSkillName(candidate);

    const reason = candidate.repeatCount >= MIN_REPEAT_COUNT
      ? `Detected ${candidate.repeatCount} similar tasks: "${candidate.taskDescription}"`
      : `Task complexity (${candidate.complexity.toFixed(1)}) exceeds threshold — creating skill to save time`;

    return { name, draft, reason };
  }

  // ── File Writing ────────────────────────────────────────────────

  /**
   * Write a SKILL.md to disk using atomic write (tmp → rename).
   * Does NOT overwrite existing skills — returns the existing path instead.
   *
   * @param name - Skill name (kebab-case identifier)
   * @param content - Full SKILL.md content with frontmatter + body
   * @returns Absolute path to the written SKILL.md file
   */
  async writeSkill(name: string, content: string): Promise<string> {
    const skillDir = join(this.skillsDir, name);
    const skillPath = join(skillDir, 'SKILL.md');

    // Don't overwrite existing skills
    if (existsSync(skillPath)) {
      return skillPath;
    }

    // Ensure directory exists
    if (!existsSync(skillDir)) {
      mkdirSync(skillDir, { recursive: true });
    }

    // Atomic write: tmp → rename
    const tmpPath = `${skillPath}.kode-tmp-${randomUUID()}`;
    try {
      writeFileSync(tmpPath, content, 'utf-8');
      renameSync(tmpPath, skillPath);
    } catch (err) {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
    }

    return skillPath;
  }

  // ── Task Tracking ───────────────────────────────────────────────

  /**
   * Track a completed task for pattern detection.
   *
   * Writes to ~/.kode/skills/.task-patterns.json, updating the count
   * for the matched pattern key.
   *
   * Pattern keys are derived from the task description via keyword
   * extraction (lowercased, common words stripped, bigrams).
   */
  trackTask(description: string, toolsUsed: string[], steps: string[]): void {
    const patternsPath = join(this.skillsDir, TASK_PATTERNS_FILE);
    const store = this.loadTaskPatterns(patternsPath);
    const key = this.derivePatternKey(description);

    if (store.patterns[key]) {
      store.patterns[key].count++;
      store.patterns[key].lastSeen = new Date().toISOString();
      store.patterns[key].tools = this.mergeTools(store.patterns[key].tools, toolsUsed);
      store.patterns[key].steps = steps.length > 0 ? steps : store.patterns[key].steps;
      store.patterns[key].description = description;
    } else {
      store.patterns[key] = {
        count: 1,
        tools: toolsUsed,
        lastSeen: new Date().toISOString(),
        steps,
        description,
      };
    }

    this.saveTaskPatterns(patternsPath, store);
  }

  /**
   * Get all tracked task patterns as a Map.
   */
  getTaskPatterns(): Map<string, { count: number; tools: string[] }> {
    const patternsPath = join(this.skillsDir, TASK_PATTERNS_FILE);
    const store = this.loadTaskPatterns(patternsPath);
    const result = new Map<string, { count: number; tools: string[] }>();

    for (const [key, entry] of Object.entries(store.patterns)) {
      result.set(key, { count: entry.count, tools: entry.tools });
    }

    return result;
  }

  // ── Private: LLM Prompts ────────────────────────────────────────

  private buildDraftSystemPrompt(): string {
    return `You are a skill author for the Kode Agent platform. Your task is to create a SKILL.md file that teaches an AI agent how to perform a specific task.

## SKILL.md Format

Every SKILL.md has two sections:

### 1. YAML Frontmatter (between --- markers)
\`\`\`yaml
---
name: kebab-case-name
description: One-line description for progressive disclosure
version: "1.0"
triggers:
  - "Natural language trigger 1"
  - "Natural language trigger 2"
tools:
  - ToolName1
  - ToolName2
tags:
  - category
author: auto
createdAt: ISO timestamp
updatedAt: ISO timestamp
---
\`\`\`

### 2. Markdown Body
- Clear step-by-step instructions
- Code examples where appropriate
- Common pitfalls and edge cases
- Expected outputs or verification steps

## Rules
- The name MUST be kebab-case (lowercase, hyphens)
- Triggers should be natural language phrases users might say
- Steps should be actionable (tool calls, commands, file paths)
- Keep it concise but complete — a new agent should be able to follow it`;
  }

  private buildDraftUserPrompt(candidate: SkillCreationCandidate): string {
    const steps = candidate.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const tools = candidate.toolsUsed.join(', ');

    return `Create a SKILL.md for the following task pattern:

## Task Description
${candidate.taskDescription}

## Steps Executed
${steps}

## Tools Used
${tools}

## Complexity Score
${candidate.complexity.toFixed(1)} / 1.0

## Repeat Count
${candidate.repeatCount} time(s)

Generate a complete SKILL.md with appropriate frontmatter and body.`;
  }

  // ── Private: Draft Parsing ──────────────────────────────────────

  /**
   * Clean the LLM-generated draft: strip code fences if present,
   * ensure the draft starts with --- frontmatter.
   */
  private cleanDraft(raw: string): string {
    let cleaned = raw.trim();

    // Remove markdown code fences if the LLM wrapped the output
    if (cleaned.startsWith('```')) {
      const firstNewline = cleaned.indexOf('\n');
      cleaned = firstNewline > 0 ? cleaned.slice(firstNewline + 1) : cleaned;
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3).trim();
    }

    // Ensure it starts with ---
    if (!cleaned.startsWith('---')) {
      cleaned = '---\n' + cleaned;
    }

    return cleaned;
  }

  /**
   * Extract the skill name from a generated draft by parsing frontmatter.
   */
  private extractSkillName(draft: string): string | null {
    const lines = draft.split('\n');
    let inFrontmatter = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '---') {
        if (!inFrontmatter) {
          inFrontmatter = true;
          continue;
        } else {
          break; // end of frontmatter
        }
      }

      if (inFrontmatter) {
        const match = /^name:\s*(.+)$/.exec(trimmed);
        if (match) {
          return match[1]!.trim().replace(/["']/g, '');
        }
      }
    }

    return null;
  }

  /**
   * Generate a kebab-case skill name from the task description.
   */
  private generateSkillName(candidate: SkillCreationCandidate): string {
    return candidate.taskDescription
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 50)
      .replace(/-+$/, '');
  }

  // ── Private: Pattern Storage ────────────────────────────────────

  private loadTaskPatterns(path: string): TaskPatternsStore {
    try {
      if (existsSync(path)) {
        const raw = readFileSync(path, 'utf-8');
        return JSON.parse(raw) as TaskPatternsStore;
      }
    } catch {
      // Corrupt file — start fresh
    }
    return { patterns: {} };
  }

  private saveTaskPatterns(path: string, store: TaskPatternsStore): void {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const tmpPath = `${path}.kode-tmp-${randomUUID()}`;
    try {
      writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf-8');
      renameSync(tmpPath, path);
    } catch (err) {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
    }
  }

  /**
   * Derive a stable pattern key from a task description.
   */
  private derivePatternKey(description: string): string {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
      'in', 'on', 'at', 'to', 'for', 'of', 'with', 'and', 'or',
      'it', 'its', 'this', 'that', 'from', 'by', 'as', 'into',
      'create', 'set', 'up', 'fix', 'add', 'make', 'use', 'using',
    ]);

    // Extract meaningful words
    const words = description
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !stopWords.has(w));

    // Take up to 4 meaningful words as the pattern key
    return words.slice(0, 4).join('-') || 'unknown-pattern';
  }

  private mergeTools(existing: string[], incoming: string[]): string[] {
    const set = new Set(existing);
    for (const t of incoming) {
      set.add(t);
    }
    return Array.from(set).sort();
  }
}
