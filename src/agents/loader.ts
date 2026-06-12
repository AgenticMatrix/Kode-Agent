/**
 * Agent file-loader — discovers and parses agent definitions from Markdown
 * and JSON files on disk.
 *
 * Discovery priority hierarchy (last write wins for same agentType):
 *   Layer 1: built-in (lowest)
 *   Layer 2: plugin
 *   Layer 3: userSettings   (~/.coder/agents/)
 *   Layer 4: projectSettings (<project>/.coder/agents/)
 *
 * Adapted from claude-code-best's loadAgentsDir.ts.
 */

import { readdir, readFile, stat } from 'fs/promises';
import { basename, extname, join } from 'path';
import matter from 'gray-matter';
import type { AgentDefinition, CustomAgentDefinition, SettingSource } from '../core/types.js';

/** Valid source values for file-based (custom) agent definitions. */
type CustomSource = CustomAgentDefinition['source'];
import { SETTING_SOURCE_PRIORITY } from '../core/types.js';

// ---------------------------------------------------------------------------
// Directory scanner
// ---------------------------------------------------------------------------

export interface LoadResult {
  agents: CustomAgentDefinition[];
  failedFiles: Array<{ path: string; error: string }>;
}

/**
 * Scan a directory for agent definition files (*.md / *.json / *.yaml).
 * Returns parsed AgentDefinition objects. Non-existent or unreadable
 * directories silently return an empty array.
 */
export async function loadAgentsFromDir(
  dir: string,
  source: CustomSource,
): Promise<LoadResult> {
  const agents: CustomAgentDefinition[] = [];
  const failedFiles: Array<{ path: string; error: string }> = [];

  try {
    await stat(dir);

  } catch {
    // Directory doesn't exist — no agents from this source
    return { agents, failedFiles };
  }

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { agents, failedFiles };
  }

  for (const entry of entries) {
    const ext = extname(entry).toLowerCase();
    if (!['.md', '.json', '.yaml', '.yml'].includes(ext)) continue;

    const filePath = join(dir, entry);
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      failedFiles.push({ path: filePath, error: 'Failed to read file' });
      continue;
    }

    if (ext === '.md') {
      const agent = parseAgentFromMarkdown(filePath, content, source);
      if (agent) {
        agents.push(agent);
      } else {
        failedFiles.push({ path: filePath, error: 'Failed to parse agent from markdown' });
      }
    } else {
      // JSON / YAML
      try {
        const parsed = JSON.parse(content);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          // Single agent definition
          const name = basename(entry, ext);
          const agent = parseAgentFromJson(name, parsed as Record<string, unknown>, source, filePath);
          if (agent) {
            agents.push(agent);
          } else {
            failedFiles.push({ path: filePath, error: 'Failed to parse agent from JSON' });
          }
        } else if (Array.isArray(parsed)) {
          // Array of agent definitions
          for (let i = 0; i < parsed.length; i++) {
            const item = parsed[i] as Record<string, unknown>;
            if (item && typeof item === 'object' && typeof item.name === 'string') {
              const agent = parseAgentFromJson(item.name, item, source, filePath);
              if (agent) agents.push(agent);
            }
          }
        }
      } catch {
        failedFiles.push({ path: filePath, error: 'Invalid JSON/YAML syntax' });
      }
    }
  }

  return { agents, failedFiles };
}

// ---------------------------------------------------------------------------
// Markdown parser
// ---------------------------------------------------------------------------

/**
 * Parse an agent definition from a Markdown file with YAML frontmatter.
 *
 * Expected format:
 *   ---
 *   name: my-agent
 *   description: When to use this agent
 *   tools: [bash, read, glob]
 *   model: haiku
 *   ---
 *   System prompt body here.
 */
export function parseAgentFromMarkdown(
  filePath: string,
  content: string,
  source: CustomSource,
): CustomAgentDefinition | null {
  let parsed: { data: Record<string, unknown>; content: string };

  try {
    parsed = matter(content);
  } catch {
    return null;
  }

  const { data: frontmatter, content: body } = parsed;
  const agentType = frontmatter['name'] as unknown;

  if (!agentType || typeof agentType !== 'string') {
    return null;
  }

  const whenToUseRaw = frontmatter['description'] as unknown;
  if (!whenToUseRaw || typeof whenToUseRaw !== 'string') {
    return null;
  }
  // Unescape newlines that were escaped for YAML
  const whenToUse = whenToUseRaw.replace(/\\n/g, '\n');

  const filename = basename(filePath, '.md');

  // Tools — can be a string, array of strings, or comma-separated string
  const tools = parseToolList(frontmatter['tools']);
  const disallowedTools = parseToolList(frontmatter['disallowedTools']);
  const skills = parseToolList(frontmatter['skills']);

  const model = typeof frontmatter['model'] === 'string' ? frontmatter['model'] : undefined;
  const permissionMode = typeof frontmatter['permissionMode'] === 'string' ? frontmatter['permissionMode'] : undefined;
  const maxTurns = typeof frontmatter['maxTurns'] === 'number' ? frontmatter['maxTurns'] : undefined;
  const background = frontmatter['background'] === true || frontmatter['background'] === 'true' ? true : undefined;
  const isolation = frontmatter['isolation'] === 'worktree' ? 'worktree' as const : undefined;
  const color = typeof frontmatter['color'] === 'string' ? frontmatter['color'] : undefined;
  const initialPrompt = typeof frontmatter['initialPrompt'] === 'string' ? frontmatter['initialPrompt'] : undefined;

  const systemPrompt = body.trim();

  return {
    agentType,
    whenToUse,
    getSystemPrompt: () => systemPrompt,
    source,
    filename,
    baseDir: source === 'userSettings' || source === 'projectSettings' ? source : undefined,
    ...(tools ? { tools } : {}),
    ...(disallowedTools ? { disallowedTools } : {}),
    ...(skills ? { skills } : {}),
    ...(model ? { model } : {}),
    ...(permissionMode ? { permissionMode } : {}),
    ...(maxTurns !== undefined ? { maxTurns } : {}),
    ...(background ? { background } : {}),
    ...(isolation ? { isolation } : {}),
    ...(color ? { color } : {}),
    ...(initialPrompt ? { initialPrompt } : {}),
  };
}

// ---------------------------------------------------------------------------
// JSON parser
// ---------------------------------------------------------------------------

/**
 * Parse an agent definition from a JSON object.
 *
 * Expected shape:
 *   { "description": "...", "prompt": "...", "tools": [...], ... }
 */
export function parseAgentFromJson(
  name: string,
  definition: Record<string, unknown>,
  source: CustomSource,
  filePath?: string,
): CustomAgentDefinition | null {
  const whenToUse = definition['description'];
  if (!whenToUse || typeof whenToUse !== 'string') return null;

  const prompt = definition['prompt'];
  if (!prompt || typeof prompt !== 'string') return null;

  const tools = parseToolList(definition['tools']);
  const disallowedTools = parseToolList(definition['disallowedTools']);
  const skills = parseToolList(definition['skills']);

  const model = typeof definition['model'] === 'string' ? definition['model'] : undefined;
  const permissionMode = typeof definition['permissionMode'] === 'string' ? definition['permissionMode'] : undefined;
  const maxTurns = typeof definition['maxTurns'] === 'number' ? definition['maxTurns'] : undefined;
  const background = definition['background'] === true ? true : undefined;
  const isolation = definition['isolation'] === 'worktree' ? 'worktree' as const : undefined;
  const color = typeof definition['color'] === 'string' ? definition['color'] : undefined;
  const initialPrompt = typeof definition['initialPrompt'] === 'string' ? definition['initialPrompt'] : undefined;

  const filename = filePath ? basename(filePath, extname(filePath)) : undefined;

  const systemPrompt = prompt;

  return {
    agentType: name,
    whenToUse,
    getSystemPrompt: () => systemPrompt,
    source,
    filename,
    baseDir: source === 'userSettings' || source === 'projectSettings' ? source : undefined,
    ...(tools ? { tools } : {}),
    ...(disallowedTools ? { disallowedTools } : {}),
    ...(skills ? { skills } : {}),
    ...(model ? { model } : {}),
    ...(permissionMode ? { permissionMode } : {}),
    ...(maxTurns !== undefined ? { maxTurns } : {}),
    ...(background ? { background } : {}),
    ...(isolation ? { isolation } : {}),
    ...(color ? { color } : {}),
    ...(initialPrompt ? { initialPrompt } : {}),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a frontmatter value into a string array.
 * Supports: string array, comma-separated string, single string.
 */
function parseToolList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;

  if (Array.isArray(value)) {
    const items = value.filter((v): v is string => typeof v === 'string');
    return items.length > 0 ? items : undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    const items = trimmed.split(',').map(s => s.trim()).filter(Boolean);
    return items.length > 0 ? items : undefined;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Priority-based deduplication (claude-code-best getActiveAgentsFromList)
// ---------------------------------------------------------------------------

/**
 * Filter a flat list of agent definitions to active ones.
 * When multiple definitions share the same agentType, the one with the
 * highest priority source wins (built-in < plugin < userSettings < projectSettings).
 *
 * If two definitions have the same source, the later one in the array wins.
 */
export function getActiveAgents(allAgents: AgentDefinition[]): AgentDefinition[] {
  const agentMap = new Map<string, AgentDefinition>();

  for (const agent of allAgents) {
    const existing = agentMap.get(agent.agentType);
    if (!existing) {
      agentMap.set(agent.agentType, agent);
      continue;
    }

    const existingPriority = SETTING_SOURCE_PRIORITY[existing.source];
    const newPriority = SETTING_SOURCE_PRIORITY[agent.source];

    if (newPriority >= existingPriority) {
      agentMap.set(agent.agentType, agent);
    }
  }

  return Array.from(agentMap.values());
}
