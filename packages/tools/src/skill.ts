/**
 * SkillTool — Agent invocation of SKILL.md skills
 *
 * When the Agent invokes this tool, the full SKILL.md content is loaded
 * from ~/.kode/skills/<name>/SKILL.md and returned to the Agent's context.
 * This is the trigger for Progressive Disclosure → full loading.
 *
 * The skill content is NOT stored in the tool itself — it is loaded
 * on-demand via SkillRegistry. This allows skills to be updated on disk
 * without restarting the Agent.
 *
 * Risk: SAFE — read-only access to skills directory.
 */

import {
  BaseTool,
  RiskLevel,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
} from '@kode/shared';

// ---------------------------------------------------------------------------
// Lazy import to avoid circular dependency
// ---------------------------------------------------------------------------

let _getSkillRegistry: (() => { get(name: string): { body: string; metadata: { name: string; description: string } } | undefined }) | null = null;

/**
 * Set the skill registry accessor. Called once during CLI initialization.
 */
export function setSkillRegistryAccessor(
  fn: () => { get(name: string): { body: string; metadata: { name: string; description: string } } | undefined },
): void {
  _getSkillRegistry = fn;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillInput {
  /** The skill name (kebab-case) or slash command to invoke */
  skill: string;
  /** Optional arguments passed to the skill */
  args?: string;
}

export interface SkillOutput {
  /** The skill name that was loaded */
  skillName: string;
  /** Whether the skill was successfully loaded */
  loaded: boolean;
  /** Full SKILL.md body content (if loaded) */
  content?: string;
  /** Error reason (if not loaded) */
  error?: string;
}

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

const SKILL_DESCRIPTION = `Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>", they are referring to a skill. Use this tool to invoke it.

How to invoke:
- Set \`skill\` to the exact name of an available skill (no leading slash). For plugin-namespaced skills use the fully qualified \`plugin:skill\` form.
- Set \`args\` to pass optional arguments.

Important:
- Available skills are listed in system-reminder messages in the conversation
- Only invoke a skill that appears in that list, or one the user explicitly typed as \`/<name>\` in their message. Never guess or invent a skill name from training data; otherwise do not call this tool
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)
- If you see a <command-name> tag in the current conversation turn, the skill has ALREADY been loaded — follow the instructions directly instead of calling this tool again`;

// ---------------------------------------------------------------------------
// SkillTool
// ---------------------------------------------------------------------------

export class SkillTool extends BaseTool<SkillInput, SkillOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'Skill',
      description: SKILL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          skill: {
            type: 'string',
            description: 'The name of the skill to invoke (no leading slash). For plugin skills use plugin:skill format.',
          },
          args: {
            type: 'string',
            description: 'Optional arguments to pass to the skill',
          },
        },
        required: ['skill'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.SAFE,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as SkillInput;
    if (!typed || typeof typed !== 'object') {
      return { valid: false, errors: [{ path: '', message: 'Input must be an object' }] };
    }
    if (typeof typed.skill !== 'string' || typed.skill.trim().length === 0) {
      return {
        valid: false,
        errors: [{ path: 'skill', message: 'skill must be a non-empty string' }],
      };
    }
    return { valid: true };
  }

  override async execute(input: SkillInput, _ctx: ToolContext): Promise<SkillOutput> {
    const skillName = input.skill.trim();

    // Resolve the skill from the registry
    if (!_getSkillRegistry) {
      return {
        skillName,
        loaded: false,
        error: 'Skill registry not initialized. Skills are not available in this session.',
      };
    }

    const registry = _getSkillRegistry();

    // Try exact name match first, then try with slash prefix stripped
    let skill = registry.get(skillName);
    if (!skill && skillName.startsWith('/')) {
      skill = registry.get(skillName.slice(1));
    }

    if (!skill) {
      return {
        skillName,
        loaded: false,
        error: `Skill "${skillName}" not found. Check available skills in the system prompt.`,
      };
    }

    return {
      skillName: skill.metadata.name,
      loaded: true,
      content: skill.body,
    };
  }

  override formatOutput(result: SkillOutput): string {
    if (result.loaded) {
      return `Skill "${result.skillName}" loaded successfully.`;
    }
    return `Failed to load skill "${result.skillName}": ${result.error ?? 'unknown error'}`;
  }
}
