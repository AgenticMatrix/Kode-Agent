import type { ToolExecutor, ToolResult } from '../../tools/types.js';
import type { Message, ContentBlock } from '../../core/types.js';
import { ToolRegistry } from '../../core/tool-registry.js';
import { PermissionEngine } from '../../core/permission.js';
import { PermissionMode } from '../../core/types.js';
import { SessionManager } from '../../core/session.js';
import { CheckpointManager } from '../../core/checkpoint.js';
import { filterToolsForAgent, type SubagentType } from '../tool-filtering.js';
import { SystemPromptAssembler } from '../../core/system-prompt.js';
import { query } from '../../core/query.js';

const MAX_SUBAGENT_TURNS = 20;
const SUBAGENT_CONTEXT_BUDGET = 120_000;
const SUBAGENT_MAX_CONCURRENCY = 8;

function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Extract only text content from sub-agent messages, skipping tool internals. */
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

  const agentType = (input.agent_type as SubagentType) ?? 'general-purpose';
  const prompt = input.prompt as string;
  const modelOverride = input.model as string | undefined;

  const agentId = `sub-${shortId()}`;
  const subAbortController = new AbortController();

  agentSpawn.subAgentRegistry.register({
    id: agentId,
    name: `${agentType}-${agentId}`,
    agentType,
    status: 'running',
    prompt,
    createdAt: Date.now(),
    turnCount: 0,
    messageCount: 0,
    toolCount: 0,
    abortController: subAbortController,
  });

  // Build filtered tool registry
  const parentDefs = agentSpawn.toolRegistry.getDefinitions();
  const filteredDefs = filterToolsForAgent(parentDefs, agentType);
  const subToolRegistry = new ToolRegistry();
  for (const def of filteredDefs) {
    const registration = agentSpawn.toolRegistry.get(def.name);
    if (registration) {
      subToolRegistry.register(def, registration.execute);
    }
  }

  const subPermissionEngine = new PermissionEngine(process.cwd());
  subPermissionEngine.setMode(PermissionMode.AUTO);

  const subSessionManager = new SessionManager();
  const subSession = subSessionManager.create({
    title: `Sub-agent: ${agentType}`,
    cwd: process.cwd(),
    model: modelOverride,
  });

  const subCheckpointManager = new CheckpointManager();

  const workerAssembler = new SystemPromptAssembler();
  const workerPrompt = await workerAssembler.assemble({
    cwd: process.cwd(),
    permissionMode: 'auto',
    agentRole: 'worker',
  });

  const initialMessages: Message[] = [
    { role: 'user', content: prompt },
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
      maxTurns: MAX_SUBAGENT_TURNS,
      contextBudget: SUBAGENT_CONTEXT_BUDGET,
      compactThreshold: 0.7,
      maxToolConcurrency: SUBAGENT_MAX_CONCURRENCY,
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
          // Count tools in this assistant message
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
