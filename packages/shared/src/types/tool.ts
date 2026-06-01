/**
 * Tool types — Definition, Base class, Risk Level, and execution context.
 */

import { RiskLevel } from './permission.js';
import type { JSONSchema } from './message.js';

// ---------------------------------------------------------------------------
// Risk Level (re-export for convenience)
// ---------------------------------------------------------------------------

export { RiskLevel };

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  riskLevel: RiskLevel;
  requiresApproval?: (input: unknown) => boolean;
}

// ---------------------------------------------------------------------------
// Execution Context
// ---------------------------------------------------------------------------

export interface ToolContext {
  sessionId: string;
  cwd: string;
  signal?: AbortSignal;
  env?: Record<string, string>;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
}

export interface ValidationError {
  path: string;
  message: string;
  expected?: string;
  received?: unknown;
}

// ---------------------------------------------------------------------------
// Execution Result
// ---------------------------------------------------------------------------

export interface ToolExecutionResult<TResult = unknown> {
  success: boolean;
  data?: TResult;
  error?: string;
  output?: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Base Tool (abstract class)
// ---------------------------------------------------------------------------

export abstract class BaseTool<TInput = unknown, TResult = unknown> {
  abstract get definition(): ToolDefinition;

  abstract execute(input: TInput, ctx: ToolContext): Promise<TResult>;

  validate(_input: unknown): ValidationResult {
    return { valid: true };
  }

  formatOutput(result: TResult): string {
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object') {
      return JSON.stringify(result, null, 2);
    }
    return String(result);
  }

  formatForModel(result: TResult): string {
    return this.formatOutput(result);
  }

  async run(input: unknown, ctx: ToolContext): Promise<ToolExecutionResult<TResult>> {
    const start = performance.now();
    const validation = this.validate(input);
    if (!validation.valid) {
      return {
        success: false,
        error: `Validation failed: ${validation.errors?.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
        durationMs: performance.now() - start,
      };
    }
    try {
      const result = await this.execute(input as TInput, ctx);
      return {
        success: true,
        data: result,
        output: this.formatOutput(result),
        durationMs: performance.now() - start,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: performance.now() - start,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Registry Types
// ---------------------------------------------------------------------------

export interface ToolRegistration {
  definition: ToolDefinition;
  tool: BaseTool;
}

export interface ToolCategory {
  name: string;
  description: string;
  tools: string[];
}
