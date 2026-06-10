/**
 * SystemPromptAssembler — Assembles the system prompt for the agent.
 *
 * Simplified version for coder agent. Later phases can add CODERAGENT.md
 * loading, MEMORY integration, Skills context, and Hooks context.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface SystemPrompt {
  prompt: string;
  parts: PromptPart[];
}

export interface PromptPart {
  name: string;
  content: string;
  priority: number;
}

export interface AssemblyContext {
  cwd: string;
  permissionMode: string;
  customPrompt?: string;
  appendPrompt?: string;
  agentRole?: 'default' | 'coordinator' | 'worker';
}

export class SystemPromptAssembler {
  async assemble(ctx: AssemblyContext): Promise<SystemPrompt> {
    const parts: PromptPart[] = [];

    // Base system prompt (simplified — later phases can add CODERAGENT.md loading)
    parts.push({
      name: 'base',
      content: this.getBasePrompt(ctx),
      priority: 0,
    });

    if (ctx.customPrompt) {
      parts.push({ name: 'custom', content: ctx.customPrompt, priority: 10 });
    }
    if (ctx.appendPrompt) {
      parts.push({ name: 'append', content: ctx.appendPrompt, priority: 20 });
    }

    const prompt = parts
      .sort((a, b) => a.priority - b.priority)
      .map(p => p.content)
      .join('\n\n');

    return { prompt, parts };
  }

  private getBasePrompt(ctx: AssemblyContext): string {
    switch (ctx.agentRole) {
      case 'worker':
        return this.getWorkerPrompt(ctx);
      case 'coordinator':
        return this.getCoordinatorPrompt(ctx);
      default:
        return this.getDefaultPrompt(ctx);
    }
  }

  private getDefaultPrompt(ctx: AssemblyContext): string {
    const mode = ctx.permissionMode;
    return [
      `You are CoderAgent, a fully open-source coding agent. You help users write, edit, and understand code.`,
      `Working directory: ${ctx.cwd}`,
      `Permission mode: ${mode}`,
      mode === 'plan' ? 'Plan mode is active — you should plan before executing.' : '',
      `You have access to tools for reading, writing, editing files, running shell commands, searching code, and more.`,
      `Use tools when needed. Think step by step.`,
    ].filter(Boolean).join('\n');
  }

  private getWorkerPrompt(ctx: AssemblyContext): string {
    return [
      `You are a sub-agent worker spawned by CoderAgent to complete a specific task.`,
      `Working directory: ${ctx.cwd}`,
      `You have a focused task. Complete it efficiently using the tools available to you.`,
      `When finished, return a concise summary of your findings and results.`,
      `You CANNOT spawn additional sub-agents.`,
      `Do not ask the user questions — you are operating autonomously.`,
    ].join('\n');
  }

  private getCoordinatorPrompt(ctx: AssemblyContext): string {
    const mode = ctx.permissionMode;
    return [
      `You are CoderAgent, a fully open-source coding agent. You help users write, edit, and understand code.`,
      `Working directory: ${ctx.cwd}`,
      `Permission mode: ${mode}`,
      mode === 'plan' ? 'Plan mode is active — you should plan before executing.' : '',
      `You have access to agent-spawn for delegating subtasks to sub-agents.`,
      `Sub-agents can run in parallel. Use agent-spawn for independent research tasks.`,
      `Use agent-read to check sub-agent progress and agent-stop to cancel them.`,
      `Use tools when needed. Think step by step.`,
    ].filter(Boolean).join('\n');
  }
}
