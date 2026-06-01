/**
 * AskUserQuestionTool — Interactively ask the user questions during execution.
 *
 * Uses a global pendingQuestions Map pattern. When execute() is called, it
 * creates a Promise that resolves when the TUI layer calls resolveQuestions().
 * This allows the tool to block the Agent Loop until the user answers.
 *
 * Supports 1-4 questions, each with multiSelect option.
 *
 * Risk: SAFE — read-only user interaction.
 */

import {
  BaseTool,
  RiskLevel,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
} from '@kode/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuestionOption {
  label: string;
  description: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface AskUserQuestionInput {
  questions: Question[];
}

export interface AskUserQuestionOutput {
  requestId: string;
  status: 'answered' | 'timeout' | 'cancelled';
  answers: Record<string, string>;
  answeredAt: string;
}

// ---------------------------------------------------------------------------
// Global pending questions queue (consumed by TUI layer)
// ---------------------------------------------------------------------------

interface PendingEntry {
  input: AskUserQuestionInput;
  resolve: (answers: Record<string, string>) => void;
  reject: (reason: Error) => void;
  createdAt: number;
  timeoutMs: number;
}

export const pendingQuestions: Map<string, PendingEntry> = new Map();

/**
 * Called by the TUI layer after the user has answered all questions.
 *
 * @param requestId - The unique request identifier returned by execute().
 * @param answers   - Map of question → selected answer(s). For multiSelect,
 *                    answers should be comma-separated values.
 */
export function resolveQuestions(requestId: string, answers: Record<string, string>): void {
  const entry = pendingQuestions.get(requestId);
  if (entry) {
    entry.resolve(answers);
    pendingQuestions.delete(requestId);
  }
}

/**
 * Called by the TUI layer if the user cancels the question dialog.
 */
export function cancelQuestions(requestId: string, reason: string = 'User cancelled'): void {
  const entry = pendingQuestions.get(requestId);
  if (entry) {
    entry.reject(new Error(reason));
    pendingQuestions.delete(requestId);
  }
}

/**
 * Get all currently pending question IDs for the TUI to poll.
 */
export function getPendingRequestIds(): string[] {
  return [...pendingQuestions.keys()];
}

/**
 * Get a pending question entry by ID (for TUI to read question details).
 */
export function getPendingQuestion(requestId: string): PendingEntry | undefined {
  return pendingQuestions.get(requestId);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateRequestId(): string {
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---------------------------------------------------------------------------
// Timeout management — reject stale entries
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Periodically clean up timed-out entries
const CLEANUP_INTERVAL_MS = 30_000; // 30 seconds
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanupRunning(): void {
  if (cleanupTimer !== null) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of pendingQuestions) {
      if (now - entry.createdAt > entry.timeoutMs) {
        entry.reject(new Error('Question timed out waiting for user response'));
        pendingQuestions.delete(id);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// AskUserQuestionTool
// ---------------------------------------------------------------------------

const ASK_USER_QUESTION_DESCRIPTION = `Ask the user one or more questions to gather preferences or clarify requirements.

Use this tool when you need user input to proceed:
- Multiple choice questions (single or multi-select)
- Supports 1-4 questions per call
- Each question can have 2-4 options
- Questions are presented to the user in a dialog

The tool will pause execution until the user answers.`;

export class AskUserQuestionTool extends BaseTool<AskUserQuestionInput, AskUserQuestionOutput> {
  override get definition(): ToolDefinition {
    return {
      name: 'AskUserQuestion',
      description: ASK_USER_QUESTION_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            description: 'Array of questions to ask the user (1-4 questions)',
            items: {
              type: 'object',
              properties: {
                question: {
                  type: 'string',
                  description: 'The complete question text to display to the user',
                },
                header: {
                  type: 'string',
                  description: 'Short label (max 12 characters) used as a chip/tag',
                },
                options: {
                  type: 'array',
                  description: 'Available choices for this question (2-4 options)',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string', description: 'Display text (1-5 words)' },
                      description: { type: 'string', description: 'What this option means' },
                    },
                    required: ['label', 'description'],
                    additionalProperties: false,
                  },
                },
                multiSelect: {
                  type: 'boolean',
                  description: 'Whether the user can select multiple options',
                  default: false,
                },
              },
              required: ['question', 'header', 'options'],
              additionalProperties: false,
            },
          },
        },
        required: ['questions'],
        additionalProperties: false,
      },
      riskLevel: RiskLevel.SAFE,
    };
  }

  override validate(input: unknown): ValidationResult {
    const typed = input as AskUserQuestionInput;
    if (!typed || typeof typed !== 'object') {
      return { valid: false, errors: [{ path: '', message: 'Input must be an object' }] };
    }

    if (!Array.isArray(typed.questions)) {
      return { valid: false, errors: [{ path: 'questions', message: 'questions must be an array' }] };
    }

    if (typed.questions.length === 0) {
      return { valid: false, errors: [{ path: 'questions', message: 'At least 1 question is required' }] };
    }

    if (typed.questions.length > 4) {
      return { valid: false, errors: [{ path: 'questions', message: 'Maximum 4 questions allowed' }] };
    }

    for (let i = 0; i < typed.questions.length; i++) {
      const q = typed.questions[i];
      if (!q || typeof q !== 'object') {
        return { valid: false, errors: [{ path: `questions[${i}]`, message: 'Each question must be an object' }] };
      }
      if (typeof q.question !== 'string' || q.question.trim().length === 0) {
        return { valid: false, errors: [{ path: `questions[${i}].question`, message: 'question must be a non-empty string' }] };
      }
      if (typeof q.header !== 'string' || q.header.trim().length === 0) {
        return { valid: false, errors: [{ path: `questions[${i}].header`, message: 'header must be a non-empty string' }] };
      }
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) {
        return { valid: false, errors: [{ path: `questions[${i}].options`, message: 'options must be an array with 2-4 items' }] };
      }
      for (let j = 0; j < q.options.length; j++) {
        const opt = q.options[j];
        if (!opt || typeof opt !== 'object') {
          return { valid: false, errors: [{ path: `questions[${i}].options[${j}]`, message: 'Each option must be an object' }] };
        }
        if (typeof opt.label !== 'string' || opt.label.trim().length === 0) {
          return { valid: false, errors: [{ path: `questions[${i}].options[${j}].label`, message: 'label must be a non-empty string' }] };
        }
        if (typeof opt.description !== 'string' || opt.description.trim().length === 0) {
          return { valid: false, errors: [{ path: `questions[${i}].options[${j}].description`, message: 'description must be a non-empty string' }] };
        }
      }
    }

    return { valid: true };
  }

  override async execute(
    input: AskUserQuestionInput,
    ctx: ToolContext,
  ): Promise<AskUserQuestionOutput> {
    const requestId = generateRequestId();

    // Derive timeout from context or use default
    const timeoutMs = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // Start cleanup timer if not already running
    ensureCleanupRunning();

    // Create a promise that resolves when the TUI calls resolveQuestions()
    const answerPromise = new Promise<Record<string, string>>((resolve, reject) => {
      pendingQuestions.set(requestId, {
        input,
        resolve,
        reject,
        createdAt: Date.now(),
        timeoutMs,
      });
    });

    try {
      const answers = await answerPromise;
      return {
        requestId,
        status: 'answered',
        answers,
        answeredAt: new Date().toISOString(),
      };
    } catch (error) {
      // Timeout or cancellation
      return {
        requestId,
        status: error instanceof Error && error.message.includes('timed out') ? 'timeout' : 'cancelled',
        answers: {},
        answeredAt: new Date().toISOString(),
      };
    }
  }

  override formatOutput(result: AskUserQuestionOutput): string {
    if (result.status === 'answered') {
      const lines: string[] = ['User answers:'];
      for (const [key, value] of Object.entries(result.answers)) {
        lines.push(`  ${key}: ${value}`);
      }
      return lines.join('\n');
    }
    return `[Questions ${result.status}: ${result.requestId}]`;
  }

  override formatForModel(result: AskUserQuestionOutput): string {
    if (result.status === 'answered') {
      const lines: string[] = ['## User Answers'];
      for (const [key, value] of Object.entries(result.answers)) {
        lines.push(`- **${key}**: ${value}`);
      }
      return lines.join('\n');
    }
    return `User did not answer the questions (status: ${result.status}).`;
  }
}
