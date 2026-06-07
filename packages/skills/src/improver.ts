/**
 * improver.ts — SkillImprover: post-execution skill refinement
 *
 * After an agent executes a task using a skill, the improver analyzes
 * the execution result to identify improvements. It can add missing steps,
 * update triggers, refine descriptions, and capture edge cases.
 *
 * Flow:
 *  1. analyzeExecution() — LLM compares expected vs actual steps
 *  2. applyImprovements() — merge suggestions into the skill
 *  3. writeImprovedSkill() — create .bak backup, then write new version
 *  4. autoImprove() — convenience: analyze → apply → write
 *
 * Architecture reference: ARCHITECTURE.md §4.11, SPRINT_PLAN.md §5.10
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, copyFileSync, unlinkSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

import type {
  Skill,
  SkillImprovementSuggestion,
} from './types.js';

// ---------------------------------------------------------------------------
// AsyncGenerator type alias
// ---------------------------------------------------------------------------

type CallModelFn = (params: {
  system: string;
  messages: Array<{ role: string; content: string }>;
  tools: unknown[];
  signal: AbortSignal;
}) => AsyncGenerator<unknown>;

// ---------------------------------------------------------------------------
// Execution Result type
// ---------------------------------------------------------------------------

export interface SkillExecutionResult {
  /** Whether the skill execution succeeded */
  success: boolean;
  /** Steps the skill defined (expected) */
  expectedSteps: string[];
  /** Steps actually executed by the agent */
  actualSteps?: string[];
  /** Issues encountered during execution */
  issues?: string[];
  /** Feedback from the user (if any) */
  userFeedback?: string;
}

// ---------------------------------------------------------------------------
// SkillImprover
// ---------------------------------------------------------------------------

export class SkillImprover {
  private callModel: CallModelFn;

  constructor(config: {
    callModel: CallModelFn;
  }) {
    this.callModel = config.callModel;
  }

  // ── Analysis ────────────────────────────────────────────────────

  /**
   * Analyze a skill execution and generate improvement suggestions.
   *
   * Sends the expected vs actual steps to the LLM, asking it to identify:
   *  - Missing steps (expected but not actually executed, or vice versa)
   *  - Better tool choices
   *  - Undocumented edge cases
   *  - Outdated triggers
   *
   * @returns Array of improvement suggestions (empty if none found).
   */
  async analyzeExecution(
    skill: Skill,
    executionResult: SkillExecutionResult,
  ): Promise<SkillImprovementSuggestion[]> {
    if (!executionResult.actualSteps || executionResult.actualSteps.length === 0) {
      // No actual steps to compare — can't analyze
      return [];
    }

    const systemPrompt = this.buildAnalysisSystemPrompt();
    const userPrompt = this.buildAnalysisUserPrompt(skill, executionResult);

    const response = await this.callLLM(systemPrompt, userPrompt);
    return this.parseSuggestions(response);
  }

  // ── Application ─────────────────────────────────────────────────

  /**
   * Apply improvement suggestions to a skill.
   *
   * Modifies the skill's body and metadata in memory. Does NOT write
   * to disk — use writeImprovedSkill() for that.
   *
   * @param skill - The skill to improve (modified in place)
   * @param suggestions - Improvement suggestions from analyzeExecution()
   * @returns The updated skill (same reference).
   */
  applyImprovements(
    skill: Skill,
    suggestions: SkillImprovementSuggestion[],
  ): Skill {
    if (suggestions.length === 0) return skill;

    let body = skill.body;

    for (const suggestion of suggestions) {
      switch (suggestion.field) {
        case 'steps':
          // Append new steps to the body
          if (suggestion.suggested && !body.includes(suggestion.suggested)) {
            body += `\n- ${suggestion.suggested}`;
          }
          break;

        case 'triggers':
          // Add new triggers to metadata
          if (suggestion.suggested) {
            const newTriggers = skill.metadata.triggers ?? [];
            const suggestedTriggers = suggestion.suggested
              .split(',')
              .map((t) => t.trim().replace(/["']/g, ''))
              .filter((t) => t.length > 0 && !newTriggers.includes(t));
            skill.metadata.triggers = [...newTriggers, ...suggestedTriggers];
          }
          break;

        case 'description':
          // Update description if suggested is better
          if (suggestion.suggested && suggestion.suggested.length > skill.metadata.description.length) {
            skill.metadata.description = suggestion.suggested;
          }
          break;

        case 'tools':
          // Add new tools to metadata
          if (suggestion.suggested) {
            const currentTools = skill.metadata.tools ?? [];
            const newTools = suggestion.suggested
              .split(',')
              .map((t) => t.trim())
              .filter((t) => t.length > 0 && !currentTools.includes(t));
            if (newTools.length > 0) {
              skill.metadata.tools = [...currentTools, ...newTools];
            }
          }
          break;

        case 'edge_cases':
          // Append edge case notes to the body
          if (suggestion.suggested && !body.includes(suggestion.suggested)) {
            body += `\n\n## Edge Cases\n${suggestion.suggested}`;
          }
          break;
      }
    }

    skill.body = body;
    skill.metadata.updatedAt = new Date().toISOString();

    // Increment version
    if (skill.metadata.version) {
      const parts = skill.metadata.version.split('.');
      const patch = parseInt(parts[parts.length - 1] ?? '0', 10);
      parts[parts.length - 1] = String(patch + 1);
      skill.metadata.version = parts.join('.');
    }

    return skill;
  }

  // ── Persistence ─────────────────────────────────────────────────

  /**
   * Write an improved skill to disk.
   *
   * Creates a .bak backup of the original file before overwriting.
   *
   * @returns Absolute path to the updated SKILL.md file.
   */
  async writeImprovedSkill(skill: Skill): Promise<string> {
    const skillPath = skill.path;
    const backupPath = `${skillPath}.bak`;

    // Create backup of current version
    if (existsSync(skillPath)) {
      try {
        copyFileSync(skillPath, backupPath);
      } catch {
        // If backup fails, proceed without it
      }
    }

    // Rebuild SKILL.md content
    const content = this.buildSkillMarkdown(skill);

    // Atomic write
    const dir = dirname(skillPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const tmpPath = `${skillPath}.coder-tmp-${randomUUID()}`;
    try {
      writeFileSync(tmpPath, content, 'utf-8');
      renameSync(tmpPath, skillPath);
    } catch (err) {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
    }

    return skillPath;
  }

  /**
   * Full auto-improve flow: analyze → apply → write.
   *
   * @returns The updated skill, or null if no improvements were found.
   */
  async autoImprove(
    skill: Skill,
    executionResult: SkillExecutionResult,
  ): Promise<Skill | null> {
    const suggestions = await this.analyzeExecution(skill, executionResult);

    if (suggestions.length === 0) return null;

    this.applyImprovements(skill, suggestions);
    await this.writeImprovedSkill(skill);

    return skill;
  }

  /**
   * Create a backup of a skill file.
   *
   * @returns Path to the backup file.
   */
  createBackup(skill: Skill): string {
    const backupPath = `${skill.path}.bak`;
    if (existsSync(skill.path)) {
      copyFileSync(skill.path, backupPath);
    }
    return backupPath;
  }

  // ── Private: LLM Interaction ────────────────────────────────────

  private buildAnalysisSystemPrompt(): string {
    return `You are a skill quality analyst for the Coder Agent platform. Your job is to compare what a skill expected with what actually happened during execution, and suggest concrete improvements.

## What to look for

1. **Missing steps**: Steps the agent had to do that weren't in the skill
2. **Wrong tool choices**: Tools that could be replaced with better alternatives
3. **Outdated triggers**: Triggers that don't match the actual task pattern
4. **Incomplete descriptions**: Descriptions that are too vague
5. **Edge cases**: Situations where the skill broke or needed workarounds

## Output Format

Return a JSON array of improvement objects. Each object has:
- "field": one of "steps", "triggers", "description", "tools", "edge_cases"
- "current": the current text/value
- "suggested": the improved text/value
- "reason": why this improvement helps

Return an empty array [] if no improvements are needed.

Only respond with the JSON array — no other text.`;
  }

  private buildAnalysisUserPrompt(
    skill: Skill,
    result: SkillExecutionResult,
  ): string {
    const expected = result.expectedSteps.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const actual = result.actualSteps?.map((s, i) => `${i + 1}. ${s}`).join('\n') ?? '(none recorded)';
    const issues = result.issues?.map((s) => `- ${s}`).join('\n') ?? '(none)';
    const feedback = result.userFeedback ?? '(none)';

    return `Analyze this skill execution and suggest improvements:

## Skill: ${skill.metadata.name}
**Description**: ${skill.metadata.description}
**Current Triggers**: ${(skill.metadata.triggers ?? []).join(', ') || '(none)'}
**Current Tools**: ${(skill.metadata.tools ?? []).join(', ') || '(none)'}

## Expected Steps
${expected}

## Actual Steps Executed
${actual}

## Issues Encountered
${issues}

## User Feedback
${feedback}

## Success: ${result.success ? 'Yes' : 'No'}

Return a JSON array of SkillImprovementSuggestion objects. Only include suggestions that would genuinely improve the skill.`;
  }

  private async callLLM(system: string, userPrompt: string): Promise<string> {
    let fullResponse = '';

    const signal = new AbortController().signal;
    const generator = this.callModel({
      system,
      messages: [{ role: 'user', content: userPrompt }],
      tools: [],
      signal,
    });

    for await (const event of generator) {
      const ev = event as Record<string, unknown>;

      if (ev.type === 'content_block_delta' && ev.delta) {
        const delta = ev.delta as Record<string, unknown>;
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          fullResponse += delta.text;
        }
      }

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

    return fullResponse.trim();
  }

  private parseSuggestions(response: string): SkillImprovementSuggestion[] {
    // Try to extract JSON from the response
    let jsonStr = response;

    // Remove markdown code fences
    const jsonMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(response);
    if (jsonMatch) {
      jsonStr = jsonMatch[1]!.trim();
    }

    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (s: unknown): s is SkillImprovementSuggestion =>
            typeof s === 'object' && s !== null &&
            typeof (s as SkillImprovementSuggestion).field === 'string' &&
            typeof (s as SkillImprovementSuggestion).reason === 'string',
        );
      }
    } catch {
      // LLM didn't return valid JSON — no suggestions
    }

    return [];
  }

  // ── Private: Serialization ──────────────────────────────────────

  /**
   * Rebuild a complete SKILL.md from a Skill object.
   */
  private buildSkillMarkdown(skill: Skill): string {
    const m = skill.metadata;

    let frontmatter = '---\n';
    frontmatter += `name: ${m.name}\n`;
    frontmatter += `description: ${m.description}\n`;
    if (m.version) frontmatter += `version: "${m.version}"\n`;
    if (m.triggers && m.triggers.length > 0) {
      frontmatter += 'triggers:\n';
      for (const t of m.triggers) {
        frontmatter += `  - "${t}"\n`;
      }
    }
    if (m.tools && m.tools.length > 0) {
      frontmatter += 'tools:\n';
      for (const t of m.tools) {
        frontmatter += `  - ${t}\n`;
      }
    }
    if (m.tags && m.tags.length > 0) {
      frontmatter += 'tags:\n';
      for (const t of m.tags) {
        frontmatter += `  - ${t}\n`;
      }
    }
    if (m.author) frontmatter += `author: ${m.author}\n`;
    frontmatter += `createdAt: ${m.createdAt}\n`;
    frontmatter += `updatedAt: ${m.updatedAt}\n`;
    frontmatter += '---\n';

    return frontmatter + '\n' + skill.body;
  }
}
