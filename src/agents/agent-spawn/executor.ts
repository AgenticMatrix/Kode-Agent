import type { ToolExecutor, ToolResult } from '../../tools/types.js';
import type { Message, ContentBlock } from '../../core/types.js';
import type { SystemPrompt } from '../../core/system-prompt.js';
import { ToolRegistry } from '../../core/tool-registry.js';
import { PermissionEngine } from '../../core/permission.js';
import { PermissionMode } from '../../core/types.js';
import { SessionManager } from '../../core/session.js';
import { CheckpointManager } from '../../core/checkpoint.js';
import { filterToolsForAgent } from '../tool-filtering.js';
import { query } from '../../core/query.js';

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

export const execute: ToolExecutor = async (input, options): Promise<ToolResult> => {
  const agentSpawn = options.agentSpawn;
  if (!agentSpawn) {
    return {
      content: 'agent-spawn requires agentSpawn context.',
      isError: true,
    };
  }

  const agentType = (input.agent_type as string) ?? 'general-purpose';
  const prompt = input.prompt as string;
  const modelOverride = input.model as string | undefined;

  // Look up agent definition from the registry
  const agentDef = agentSpawn.agentRegistry?.get(agentType);
  if (!agentDef) {
    const available = agentSpawn.agentRegistry?.list().map(a => a.agentType).join(', ') ?? 'none';
    return {
      content: `Unknown agent type: ${agentType}. Available: ${available}`,
      isError: true,
    };
  }

  const agentId = `sub-${shortId()}`;
  const subAbortController = new AbortController();

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
    // background: agentDef.background — when true, the agent runs asynchronously
    // and the main loop does NOT block on it (future enhancement).
  });

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

  const subPermissionEngine = new PermissionEngine(process.cwd());
  subPermissionEngine.setMode(PermissionMode.AUTO);

  const effectiveModel = modelOverride ?? agentDef.model;
  const subSessionManager = new SessionManager();
  const subSession = subSessionManager.create({
    title: `Sub-agent: ${agentType}`,
    cwd: process.cwd(),
    model: effectiveModel,
  });

  const subCheckpointManager = new CheckpointManager();

  // Use agent definition's system prompt
  const workerPrompt: SystemPrompt = {
    prompt: agentDef.getSystemPrompt(),
    parts: [{ name: `agent-${agentType}`, content: agentDef.getSystemPrompt(), priority: 0 }],
  };

  const effectiveMaxTurns = agentDef.maxTurns ?? DEFAULT_MAX_TURNS;
  const effectiveContextBudget = agentDef.contextBudget ?? DEFAULT_CONTEXT_BUDGET;

  // Prepend initialPrompt if defined on the agent definition
  const userPrompt = agentDef.initialPrompt
    ? `${agentDef.initialPrompt}\n\n${prompt}`
    : prompt;

  const initialMessages: Message[] = [
    { role: 'user', content: userPrompt },
  ];

  const startTime = Date.now();
  let assistantTurnCount = 0;
  let messageCount = 0;
  let toolCount = 0;
  const transcript: Message[] = [];

  try {
    const generator = query({
      sessionId: subSession.id,
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
        default:
          break;
      }
      messageCount++;
    }

    const result = compressTranscript(transcript);

    agentSpawn.subAgentRegistry.update(agentId, {
      status: subAbortController.signal.aborted ? 'stopped' : 'done',
      finishedAt: Date.now(),
      turnCount: assistantTurnCount,
      messageCount: transcript.length,
      toolCount,
      result,
      transcript,
    });

    return {
      content: `Sub-agent ${agentId} (${agentType}) completed. ${assistantTurnCount} LLM turns, ${toolCount} tools used.\n\n${result}`,
      isError: false,
      duration: Date.now() - startTime,
      metadata: {
        agentId,
        agentType,
        turnCount: assistantTurnCount,
        messageCount: transcript.length,
        toolCount,
        duration: Date.now() - startTime,
      },
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    agentSpawn.subAgentRegistry.update(agentId, {
      status: 'error',
      finishedAt: Date.now(),
      turnCount: assistantTurnCount,
      messageCount: transcript.length,
      toolCount,
      error: errorMsg,
    });

    return {
      content: `Sub-agent ${agentId} (${agentType}) error after ${assistantTurnCount} turns: ${errorMsg}`,
      isError: true,
      duration: Date.now() - startTime,
      metadata: { agentId, agentType, error: errorMsg },
    };
  }
};
