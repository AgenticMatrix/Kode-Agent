/**
 * SystemPromptAssembler — Dynamic system prompt assembly
 *
 * Dynamically assembles the system prompt from multiple sources:
 * 1. Base harness instructions (tool usage, message format, permissions)
 * 2. KODE.md / CLAUDE.md / .kode/ project context (discovered from filesystem)
 * 3. Rules directory (path-scoped .kode/rules/*.md — Phase 5)
 * 4. MEMORY.md memories (from FTS5 store)
 * 5. Active skills summary (progressive disclosure)
 * 6. MCP context (server-provided resources and prompts)
 * 7. User custom prompt
 *
 * Dynamic system prompt assembly with multi-source context injection.
 * Reference: ARCHITECTURE.md §4.2
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { IMemoryStore } from '../memory/store.js';
import { getCoordinatorPrompt } from './coordinator.js';
import type { RuleManager } from '../rules-manager.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptPart {
  source: string;
  content: string;
}

export interface AssemblyContext {
  /** Working directory — used to discover KODE.md / CLAUDE.md */
  cwd: string;
  /** User's query for memory selection */
  query?: string;
  /** Custom system prompt from CLI flags */
  customPrompt?: string;
  /** Append prompt (added after main prompt) */
  appendPrompt?: string;
  /** Selected memories */
  memories?: string[];
  /** Active skill summaries */
  skillSummaries?: string[];
  /** MCP context strings */
  mcpContext?: string;
  /** Permission mode for instruction selection */
  permissionMode?: 'plan' | 'ask' | 'auto';
  /** Agent role for mode-specific prompt injection */
  agentRole?: 'coordinator' | 'worker' | 'default';
  /**
   * Optional RuleManager for loading path-scoped rules from .kode/rules/*.md.
   * When provided and activeFilePath is set, matching rules are injected
   * into the system prompt. (Phase 5 — matches Claude Code's rules directory)
   */
  ruleManager?: RuleManager;
  /**
   * Currently active file path (e.g. file being read/written/edited).
   * Used by RuleManager.getMatchingRules() to select path-scoped rules.
   */
  activeFilePath?: string;
  /**
   * Currently active tool name (e.g. 'Read', 'Write', 'Edit').
   * Passed to RuleManager for context-aware rule matching.
   */
  currentToolName?: string;
  /**
   * Optional MemoryStore for auto-selecting relevant memories.
   * When provided and `memories` is not explicitly set, the assembler
   * calls `memoryStore.selectRelevant(messages)` to populate memories.
   */
  memoryStore?: IMemoryStore;
  /**
   * Recent conversation messages for memory relevance matching.
   * Required when `memoryStore` is provided without explicit `memories`.
   */
  messages?: Array<{ role: string; content: string | unknown }>;
}

export interface SystemPrompt {
  prompt: string;
  parts: PromptPart[];
  estimatedTokens: number;
}

// ---------------------------------------------------------------------------
// Base Instructions
// ---------------------------------------------------------------------------

const BASE_INSTRUCTIONS = `You are Kode Agent, an Open-Source Coding Agent built by the open-source community.

## Your Capabilities
- Read, write, and edit files
- Execute bash commands
- Search code with glob patterns and regex
- Manage git repositories
- Create and track tasks
- Delegate work to sub-agents

## Tool Usage
- Always use absolute file paths
- Read files before editing them
- Prefer editing existing files over creating new ones
- Each tool call must include a clear description

## Response Style
- Be concise and direct
- Explain your reasoning before making changes
- Ask clarifying questions when needed
- Report errors honestly

## Safety
- Never execute dangerous commands without confirmation
- Never skip git hooks
- Never force push to main/master`;

const PLAN_MODE_INSTRUCTIONS = `
## Plan Mode
You are in PLAN MODE. You can ONLY:
- Read files (Read tool)
- Search code (Glob, Grep tools)
- View git status (Git tool)
- Ask the user questions

You CANNOT:
- Write or edit files
- Execute bash commands
- Make git commits

Focus on understanding the codebase and designing a plan.`;


const WORKER_INSTRUCTIONS = `
## Worker Mode
You are operating as a **Worker Agent**. Your responsibilities:
1. Execute sub-tasks assigned by the Coordinator
2. Write, edit, and test code
3. Report results back to the Coordinator

**Focus**: Complete your assigned sub-task efficiently. Do not attempt to decompose further or delegate.`;

// ---------------------------------------------------------------------------
// SystemPromptAssembler
// ---------------------------------------------------------------------------

export class SystemPromptAssembler {
  /**
   * Assemble the complete system prompt from all sources.
   */
  async assemble(ctx: AssemblyContext): Promise<SystemPrompt> {
    const parts: PromptPart[] = [];

    // 1. Base harness instructions
    let baseInstructions = BASE_INSTRUCTIONS;
    if (ctx.permissionMode === 'plan') {
      baseInstructions += PLAN_MODE_INSTRUCTIONS;
    }
    parts.push({ source: 'base', content: baseInstructions });

    // 2. Discover and load KODE.md / CLAUDE.md files
    const contextFiles = this.discoverContextFiles(ctx.cwd);
    for (const file of contextFiles) {
      parts.push({ source: file.source, content: file.content });
    }

    // 2.5. Path-scoped rules from .kode/rules/*.md (Phase 5)
    //      Injected between project context and memory so rules are highly visible.
    if (ctx.ruleManager) {
      const matchingRules = ctx.ruleManager.getMatchingRules({
        cwd: ctx.cwd,
        currentToolName: ctx.currentToolName,
        currentFilePath: ctx.activeFilePath,
      });
      if (matchingRules.length > 0) {
        const rulesBlock = ctx.ruleManager.formatRulesForPrompt(matchingRules);
        parts.push({ source: 'rules', content: rulesBlock });
      }
    }

    // 3. Memory injection
    // Auto-select relevant memories from MemoryStore if provided and
    // explicit memories are not already set by the caller.
    let memories = ctx.memories;
    if (!memories && ctx.memoryStore && ctx.messages && ctx.messages.length > 0) {
      const results = ctx.memoryStore.selectRelevant(ctx.messages, 5);
      memories = results.map((r) => r.memory.content);
    }
    if (memories && memories.length > 0) {
      const memoryBlock = this.formatMemories(memories);
      parts.push({ source: 'memory', content: memoryBlock });
    }

    // 4. Active skills summary (progressive disclosure)
    if (ctx.skillSummaries && ctx.skillSummaries.length > 0) {
      const skillBlock = this.formatSkillSummaries(ctx.skillSummaries);
      parts.push({ source: 'skills', content: skillBlock });
    }

    // 4.5. Role-specific instructions (Coordinator / Worker mode)
    if (ctx.agentRole === 'coordinator') {
      parts.push({ source: 'role', content: getCoordinatorPrompt() });
    } else if (ctx.agentRole === 'worker') {
      parts.push({ source: 'role', content: WORKER_INSTRUCTIONS });
    }

    // 5. MCP context
    if (ctx.mcpContext) {
      parts.push({ source: 'mcp', content: ctx.mcpContext });
    }

    // 6. User custom prompt (the append prompt)
    if (ctx.appendPrompt) {
      parts.push({ source: 'append', content: ctx.appendPrompt });
    }

    // 7. User custom prompt (replaces base if set)
    if (ctx.customPrompt) {
      // Custom prompt replaces all parts
      parts.length = 0;
      parts.push({ source: 'user', content: ctx.customPrompt });
    }

    const prompt = parts.map((p) => p.content).join('\n\n');
    const estimatedTokens = Math.ceil(prompt.length / 3.5); // rough estimate: ~3.5 chars per token

    return { prompt, parts, estimatedTokens };
  }

  /**
   * Discover KODE.md / CLAUDE.md / CODEBUDDY.md files from cwd up to root.
   */
  discoverContextFiles(cwd: string): PromptPart[] {
    const files: PromptPart[] = [];
    const searchNames = ['KODE.md', 'CLAUDE.md', 'CODEBUDDY.md', '.koderules', '.cursorrules'];

    let dir = cwd;
    while (dir !== dirname(dir)) {
      for (const name of searchNames) {
        const filePath = join(dir, name);
        if (existsSync(filePath)) {
          try {
            const content = readFileSync(filePath, 'utf-8');
            files.unshift({ source: filePath, content });
          } catch {
            // Permission error — skip
          }
        }
      }
      dir = dirname(dir);
    }

    // Also check home directory
    for (const name of searchNames) {
      const homePath = join(homedir(), name);
      if (existsSync(homePath)) {
        try {
          const content = readFileSync(homePath, 'utf-8');
          files.push({ source: homePath, content });
        } catch {
          // skip
        }
      }
    }

    return files;
  }

  /**
   * Format memories for system prompt injection.
   */
  private formatMemories(memories: string[]): string {
    const header = '## Relevant Memories';
    const items = memories.map((m) => `- ${m}`).join('\n');
    return `${header}\n${items}`;
  }

  /**
   * Format skill summaries for progressive disclosure.
   */
  private formatSkillSummaries(skills: string[]): string {
    const header = '## Available Skills';
    const items = skills.map((s) => `- ${s}`).join('\n');
    return `${header}\n${items}`;
  }
}
