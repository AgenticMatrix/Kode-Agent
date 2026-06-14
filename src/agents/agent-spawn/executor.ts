import type { ToolExecutor, ToolResult } from '../../tools/types.js';
import type { Message, ContentBlock, AgentSpawnContext, ToolContext } from '../../core/types.js';
import type { SystemPrompt, SystemPromptAssembler } from '../../core/system-prompt.js';
import { ToolRegistry } from '../../core/tool-registry.js';
import { PermissionEngine } from '../../core/permission.js';
import { PermissionMode, RiskLevel } from '../../core/types.js';
import { SessionManager } from '../../core/session.js';
import { CheckpointManager } from '../../core/checkpoint.js';
import { filterToolsForAgent, GLOBAL_DISALLOWED_FOR_SUBAGENTS } from '../tool-filtering.js';
import { query } from '../../core/query.js';
import teamMessagePlugin from '../../teams/tools/team-message/index.js';

const DEFAULT_MAX_TURNS = 20;
const DEFAULT_CONTEXT_BUDGET = 120_000;
const DEFAULT_MAX_CONCURRENCY = 8;

function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function compressTranscript(messages: Message[]): string {
  const parts: string[] = [];
  for (const msg of messages.slice(-20)) {
    if (msg.role !== 'assistant') continue;
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    for (const block of blocks) {
      if (block.type === 'text') {
        const text = (block as { text?: string }).text ?? '';
        if (text) parts.push(text.slice(0, 800));
      }
    }
  }
  const body = parts.join('\n\n');
  if (!body) return '(sub-agent produced no text output)';
  if (body.length <= 2000) return body;
  return body.slice(0, 1997) + '...';
}

/**
 * Enrich an agent definition's system prompt with environment info from the
 * assembler's worker role output.
 */
async function enrichAgentPrompt(
  agentPrompt: string,
  assembler: SystemPromptAssembler,
): Promise<string> {
  try {
    const workerPrompt = await assembler.assemble({
      cwd: process.cwd(),
      permissionMode: 'auto',
      agentRole: 'worker',
    });
    const envPart = workerPrompt.parts.find(p => p.name === 'env_info');
    const permPart = workerPrompt.parts.find(p => p.name === 'permission_mode');
    const extra = [envPart?.content, permPart?.content].filter(Boolean).join('\n\n');
    if (extra) {
      return agentPrompt + '\n\n' + extra;
    }
  } catch {
    // If assembly fails, fall back to the raw agent prompt
  }
  return agentPrompt;
}

// ---------------------------------------------------------------------------
// Core runner — shared by sync and async paths
// ---------------------------------------------------------------------------

interface RunAgentParams {
  agentId: string;
  agentType: string;
  prompt: string;
  agentSpawn: AgentSpawnContext;
  systemPromptText: string;
  effectiveModel: string | undefined;
  effectiveMaxTurns: number;
  effectiveContextBudget: number;
  initialMessages: Message[];
  subToolRegistry: ToolRegistry;
  subAbortController: AbortController;
}

async function runAgentLoop(params: RunAgentParams): Promise<{
  agentId: string;
  agentType: string;
  assistantTurnCount: number;
  toolCount: number;
  transcript: Message[];
  startTime: number;
  error?: string;
}> {
  const {
    agentId, agentType, prompt, agentSpawn,
    systemPromptText, effectiveModel, effectiveMaxTurns, effectiveContextBudget,
    initialMessages, subToolRegistry, subAbortController,
  } = params;

  const subPermissionEngine = new PermissionEngine(process.cwd());
  subPermissionEngine.setMode(PermissionMode.AUTO);

  const subSessionManager = new SessionManager();
  subSessionManager.create({
    title: `Sub-agent: ${agentType}`,
    cwd: process.cwd(),
    model: effectiveModel,
  });

  const subCheckpointManager = new CheckpointManager();

  const workerPrompt: SystemPrompt = {
    prompt: systemPromptText,
    parts: [{ name: `agent-${agentType}`, content: systemPromptText, priority: 0 }],
  };

  const startTime = Date.now();
  let assistantTurnCount = 0;
  let messageCount = 0;
  let toolCount = 0;
  const transcript: Message[] = [];

  try {
    const generator = query({
      sessionId: subSessionManager.getActive()?.id ?? agentId,
      cwd: process.cwd(),
      messages: initialMessages,
      systemPrompt: workerPrompt,
      toolRegistry: subToolRegistry,
      permissionEngine: subPermissionEngine,
      sessionManager: subSessionManager,
      checkpointManager: subCheckpointManager,
      abortController: subAbortController,
      maxTurns: effectiveMaxTurns,
      contextBudget: effectiveContextBudget,
      compactThreshold: 0.7,
      maxToolConcurrency: DEFAULT_MAX_CONCURRENCY,
      callModel: agentSpawn.callModel,
      hookManager: agentSpawn.hookManager,
    });

    for await (const msg of generator) {
      if (subAbortController.signal.aborted) break;

      switch (msg.type) {
        case 'assistant': {
          assistantTurnCount++;
          const assistantMsg = msg.message as unknown as Message;
          transcript.push(assistantMsg);
          const blocks = Array.isArray(assistantMsg.content) ? assistantMsg.content : [];
          toolCount += blocks.filter((b: ContentBlock) => b.type === 'tool_use').length;
          break;
        }
        case 'user':
          transcript.push(msg.message as unknown as Message);
          break;
        case 'system':
          if (msg.subtype === 'progress') {
            agentSpawn.subAgentRegistry.update(agentId, {
              turnCount: assistantTurnCount,
              messageCount: transcript.length,
              toolCount,
            });
          }
          break;
      }
      messageCount++;
    }

    return {
      agentId, agentType, assistantTurnCount, toolCount,
      transcript, startTime,
    };
  } catch (err) {
    return {
      agentId, agentType, assistantTurnCount, toolCount,
      transcript, startTime,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

export const execute: ToolExecutor = async (input, options): Promise<ToolResult> => {
  const agentSpawn = options.agentSpawn;
  if (!agentSpawn) {
    return {
      content: 'agent-spawn requires agentSpawn context.',
      isError: true,
    };
  }

  const agentTypeInput = input.agent_type as string | undefined;
  const prompt = input.prompt as string;
  const modelOverride = input.model as string | undefined;
  const backgroundOverride = input.background as boolean | undefined;

  // ── Fork mode: no agent_type → inherit parent context ───────────────
  if (!agentTypeInput) {
    return executeFork(prompt, modelOverride, backgroundOverride, agentSpawn);
  }

  // ── Explicit agent_type path ────────────────────────────────────────
  const agentDef = agentSpawn.agentRegistry?.get(agentTypeInput);
  if (!agentDef) {
    const available = agentSpawn.agentRegistry?.list().map(a => a.agentType).join(', ') ?? 'none';
    return {
      content: `Unknown agent type: ${agentTypeInput}. Available: ${available}`,
      isError: true,
    };
  }

  const agentType = agentTypeInput;
  const agentId = `sub-${shortId()}`;
  const subAbortController = new AbortController();
  const isBackground = backgroundOverride ?? agentDef.background ?? false;

  // Build filtered tool registry from the agent definition
  const parentDefs = agentSpawn.toolRegistry.getDefinitions();
  const filteredDefs = filterToolsForAgent(parentDefs, agentDef);
  const subToolRegistry = new ToolRegistry();
  for (const def of filteredDefs) {
    const registration = agentSpawn.toolRegistry.get(def.name);
    if (registration) {
      subToolRegistry.register(def, registration.execute);
    }
  }

  // Team member: register team-message tool for inter-team communication
  const teamName = input.team_name as string | undefined;
  const memberName = input.member_name as string | undefined;
  if (teamName && memberName) {
    const teamMsgSchema = teamMessagePlugin.schema as unknown as { input_schema: Record<string, unknown>; description: string };
    subToolRegistry.register(
      {
        name: teamMessagePlugin.name,
        description: teamMsgSchema.description,
        input_schema: teamMsgSchema.input_schema,
        riskLevel: RiskLevel.SAFE,
      },
      async (toolInput: Record<string, unknown>, ctx: ToolContext) => {
        const result = await teamMessagePlugin.executor(
          { ...toolInput, from: memberName },
          {
            cwd: ctx.cwd ?? process.cwd(),
            allowMutation: true,
            maxOutput: 50_000,
            bashTimeout: 30_000,
            sessionId: ctx.sessionId,
          },
        );
        return {
          content: result.content,
          isError: result.isError,
          duration: result.duration,
          metadata: result.metadata,
        };
      },
    );
  }

  const effectiveModel = modelOverride ?? agentDef.model;

  // Prepend initialPrompt if defined
  const userPrompt = agentDef.initialPrompt
    ? `${agentDef.initialPrompt}\n\n${prompt}`
    : prompt;

  const initialMessages: Message[] = [
    { role: 'user', content: userPrompt },
  ];

  // Enrich agent prompt with environment info
  const enrichedPrompt = agentSpawn.systemPromptAssembler
    ? await enrichAgentPrompt(agentDef.getSystemPrompt(), agentSpawn.systemPromptAssembler)
    : agentDef.getSystemPrompt();

  agentSpawn.subAgentRegistry.register({
    id: agentId,
    name: `${agentType}-${agentId}`,
    agentType: agentType as 'explore' | 'plan' | 'general-purpose',
    status: 'running',
    prompt,
    createdAt: Date.now(),
    turnCount: 0,
    messageCount: 0,
    toolCount: 0,
    abortController: subAbortController,
  });

  if (isBackground) {
    // ── Async path: fire-and-forget ─────────────────────────────────
    const spawnTime = Date.now();

    runAgentLoop({
      agentId, agentType, prompt, agentSpawn,
      systemPromptText: enrichedPrompt,
      effectiveModel, subToolRegistry, subAbortController,
      effectiveMaxTurns: agentDef.maxTurns ?? DEFAULT_MAX_TURNS,
      effectiveContextBudget: agentDef.contextBudget ?? DEFAULT_CONTEXT_BUDGET,
      initialMessages,
    }).then(result => {
      const status = result.error ? 'error' : (subAbortController.signal.aborted ? 'stopped' : 'done');
      const compressed = compressTranscript(result.transcript);

      agentSpawn.subAgentRegistry.update(agentId, {
        status,
        finishedAt: Date.now(),
        turnCount: result.assistantTurnCount,
        messageCount: result.transcript.length,
        toolCount: result.toolCount,
        result: compressed,
        transcript: result.transcript,
        error: result.error,
      });

      // Push notification for the next main-loop turn
      const summary = result.error
        ? `Background agent ${agentId} (${agentType}) failed after ${result.assistantTurnCount} turns: ${result.error}`
        : `Background agent ${agentId} (${agentType}) completed. ${result.assistantTurnCount} LLM turns, ${result.toolCount} tools used.\n\n${compressed}`;
      agentSpawn.subAgentRegistry.pushNotification(summary);
    }).catch(err => {
      const errorMsg = err instanceof Error ? err.message : String(err);
      agentSpawn.subAgentRegistry.update(agentId, {
        status: 'error',
        finishedAt: Date.now(),
        error: errorMsg,
      });
      agentSpawn.subAgentRegistry.pushNotification(
        `Background agent ${agentId} (${agentType}) crashed: ${errorMsg}`,
      );
    });

    return {
      content: `Background agent ${agentId} (${agentType}) spawned. Use agent-read to check progress, agent-stop to cancel.`,
      isError: false,
      duration: Date.now() - spawnTime,
      metadata: { agentId, agentType, background: true },
    };
  }

  // ── Sync path (existing behavior) ──────────────────────────────────
  const result = await runAgentLoop({
    agentId, agentType, prompt, agentSpawn,
    systemPromptText: enrichedPrompt,
    effectiveModel, subToolRegistry, subAbortController,
    effectiveMaxTurns: agentDef.maxTurns ?? DEFAULT_MAX_TURNS,
    effectiveContextBudget: agentDef.contextBudget ?? DEFAULT_CONTEXT_BUDGET,
    initialMessages,
  });

  const status = result.error ? 'error' : (subAbortController.signal.aborted ? 'stopped' : 'done');
  const compressed = compressTranscript(result.transcript);

  agentSpawn.subAgentRegistry.update(agentId, {
    status,
    finishedAt: Date.now(),
    turnCount: result.assistantTurnCount,
    messageCount: result.transcript.length,
    toolCount: result.toolCount,
    result: compressed,
    transcript: result.transcript,
    error: result.error,
  });

  if (result.error) {
    return {
      content: `Sub-agent ${agentId} (${agentType}) error after ${result.assistantTurnCount} turns: ${result.error}`,
      isError: true,
      duration: Date.now() - result.startTime,
      metadata: { agentId, agentType, error: result.error },
    };
  }

  return {
    content: `Sub-agent ${agentId} (${agentType}) completed. ${result.assistantTurnCount} LLM turns, ${result.toolCount} tools used.\n\n${compressed}`,
    isError: false,
    duration: Date.now() - result.startTime,
    metadata: {
      agentId,
      agentType,
      turnCount: result.assistantTurnCount,
      messageCount: result.transcript.length,
      toolCount: result.toolCount,
      duration: Date.now() - result.startTime,
    },
  };
};

// ---------------------------------------------------------------------------
// Fork execution — inherit parent context
// ---------------------------------------------------------------------------

async function executeFork(
  prompt: string,
  modelOverride: string | undefined,
  backgroundOverride: boolean | undefined,
  agentSpawn: AgentSpawnContext,
): Promise<ToolResult> {
  const agentType = 'fork';
  const agentId = `fork-${shortId()}`;
  const subAbortController = new AbortController();
  const isBackground = backgroundOverride ?? false;

  // Inherit parent tools (minus globally disallowed)
  const parentDefs = agentSpawn.toolRegistry.getDefinitions();
  const filteredDefs = parentDefs.filter(t => !GLOBAL_DISALLOWED_FOR_SUBAGENTS.has(t.name));
  const subToolRegistry = new ToolRegistry();
  for (const def of filteredDefs) {
    const registration = agentSpawn.toolRegistry.get(def.name);
    if (registration) {
      subToolRegistry.register(def, registration.execute);
    }
  }

  // Inherit parent's system prompt
  let systemPromptText: string;
  try {
    const assembler = agentSpawn.systemPromptAssembler;
    const parentSystem = await assembler.assemble({
      cwd: process.cwd(),
      permissionMode: PermissionMode.AUTO,
      agentRole: 'default',
    });
    systemPromptText = parentSystem.prompt;
  } catch {
    systemPromptText = 'You are a forked sub-agent with full context of the parent agent. Complete the assigned task efficiently.';
  }

  const effectiveModel = modelOverride;
  const effectiveMaxTurns = DEFAULT_MAX_TURNS;
  const effectiveContextBudget = DEFAULT_CONTEXT_BUDGET;

  // Inherit parent's recent conversation as initial context
  const parentSession = agentSpawn.sessionManager.getActive();
  const parentMessages = parentSession?.messages ?? [];
  // Take last 20 messages to keep context manageable
  const recentMessages = parentMessages.slice(-20);

  const userPrompt = `[Forked from parent agent]\n\n${prompt}`;
  const initialMessages: Message[] = [
    ...recentMessages,
    { role: 'user', content: userPrompt },
  ];

  agentSpawn.subAgentRegistry.register({
    id: agentId,
    name: `fork-${agentId}`,
    agentType: 'general-purpose',
    status: 'running',
    prompt,
    createdAt: Date.now(),
    turnCount: 0,
    messageCount: 0,
    toolCount: 0,
    abortController: subAbortController,
  });

  if (isBackground) {
    const spawnTime = Date.now();

    runAgentLoop({
      agentId, agentType, prompt, agentSpawn,
      systemPromptText, effectiveModel, subToolRegistry, subAbortController,
      effectiveMaxTurns, effectiveContextBudget, initialMessages,
    }).then(result => {
      const status = result.error ? 'error' : (subAbortController.signal.aborted ? 'stopped' : 'done');
      const compressed = compressTranscript(result.transcript);

      agentSpawn.subAgentRegistry.update(agentId, {
        status, finishedAt: Date.now(),
        turnCount: result.assistantTurnCount,
        messageCount: result.transcript.length,
        toolCount: result.toolCount,
        result: compressed,
        transcript: result.transcript,
        error: result.error,
      });

      const summary = result.error
        ? `Fork agent ${agentId} failed after ${result.assistantTurnCount} turns: ${result.error}`
        : `Fork agent ${agentId} completed. ${result.assistantTurnCount} LLM turns, ${result.toolCount} tools used.\n\n${compressed}`;
      agentSpawn.subAgentRegistry.pushNotification(summary);
    }).catch(err => {
      agentSpawn.subAgentRegistry.update(agentId, {
        status: 'error', finishedAt: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return {
      content: `Fork agent ${agentId} spawned in background. Use agent-read to check progress.`,
      isError: false,
      duration: Date.now() - spawnTime,
      metadata: { agentId, agentType: 'fork', background: true },
    };
  }

  // Sync fork
  const result = await runAgentLoop({
    agentId, agentType, prompt, agentSpawn,
    systemPromptText, effectiveModel, subToolRegistry, subAbortController,
    effectiveMaxTurns, effectiveContextBudget, initialMessages,
  });

  const status = result.error ? 'error' : (subAbortController.signal.aborted ? 'stopped' : 'done');
  const compressed = compressTranscript(result.transcript);

  agentSpawn.subAgentRegistry.update(agentId, {
    status, finishedAt: Date.now(),
    turnCount: result.assistantTurnCount,
    messageCount: result.transcript.length,
    toolCount: result.toolCount,
    result: compressed,
    transcript: result.transcript,
    error: result.error,
  });

  if (result.error) {
    return {
      content: `Fork agent ${agentId} error after ${result.assistantTurnCount} turns: ${result.error}`,
      isError: true,
      duration: Date.now() - result.startTime,
      metadata: { agentId, agentType: 'fork', error: result.error },
    };
  }

  return {
    content: `Fork agent ${agentId} completed. ${result.assistantTurnCount} LLM turns, ${result.toolCount} tools used.\n\n${compressed}`,
    isError: false,
    duration: Date.now() - result.startTime,
    metadata: {
      agentId, agentType: 'fork',
      turnCount: result.assistantTurnCount,
      messageCount: result.transcript.length,
      toolCount: result.toolCount,
      duration: Date.now() - result.startTime,
    },
  };
}
