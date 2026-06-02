import { describe, expect, it } from 'vitest';
import {
  ToolRegistry,
  QueryEngine,
  SessionManager,
  CheckpointManager,
  PermissionEngine,
  SystemPromptAssembler,
  classifyError,
  computeBackoff,
  delay,
  withRetry,
  MaxTurnsExceededError,
  BudgetExceededError,
  StopRequestedError,
  FatalAPIError,
  ContextOverflowError,
  classifyTaskMode,
} from '../index.js';
import type {
  ToolEntry,
  ToolCategory,
  QueryConfig,
  CallModelParams,
  QueryEngineConfig,
  QueryEngineEvent,
  Checkpoint,
  CheckpointCreateOptions,
  CheckpointRestoreResult,
  ClassificationContext,
  PromptPart,
  AssemblyContext,
  SystemPrompt,
  ErrorCategory,
  ClassifiedError,
  RetryConfig,
} from '../index.js';

describe('@coder/core', () => {
  it('should export ToolRegistry', () => {
    expect(ToolRegistry).toBeDefined();
  });

  it('should export QueryEngine', () => {
    expect(QueryEngine).toBeDefined();
  });

  it('should export SessionManager', () => {
    expect(SessionManager).toBeDefined();
  });

  it('should export CheckpointManager', () => {
    expect(CheckpointManager).toBeDefined();
  });

  it('should export PermissionEngine', () => {
    expect(PermissionEngine).toBeDefined();
  });

  it('should export SystemPromptAssembler', () => {
    expect(SystemPromptAssembler).toBeDefined();
  });

  it('should export classifyError', () => {
    expect(classifyError).toBeDefined();
    expect(typeof classifyError).toBe('function');
  });

  it('should export computeBackoff', () => {
    expect(computeBackoff).toBeDefined();
    expect(typeof computeBackoff).toBe('function');
  });

  it('should export delay', () => {
    expect(delay).toBeDefined();
    expect(typeof delay).toBe('function');
  });

  it('should export withRetry', () => {
    expect(withRetry).toBeDefined();
    expect(typeof withRetry).toBe('function');
  });

  it('should export classifyTaskMode', () => {
    expect(classifyTaskMode).toBeDefined();
    expect(typeof classifyTaskMode).toBe('function');
  });

  it('should export MaxTurnsExceededError', () => {
    const err = new MaxTurnsExceededError(10);
    expect(err).toBeInstanceOf(Error);
    expect(err.maxTurns).toBe(10);
  });

  it('should export BudgetExceededError', () => {
    const err = new BudgetExceededError(5.50);
    expect(err).toBeInstanceOf(Error);
    expect(err.totalCost).toBe(5.50);
  });

  it('should export StopRequestedError', () => {
    const err = new StopRequestedError('user interrupt');
    expect(err).toBeInstanceOf(Error);
    expect(err.reason).toBe('user interrupt');
  });

  it('should export FatalAPIError', () => {
    const err = new FatalAPIError('auth failed', 'auth');
    expect(err).toBeInstanceOf(Error);
    expect(err.category).toBe('auth');
  });

  it('should export ContextOverflowError', () => {
    const err = new ContextOverflowError(0.96);
    expect(err).toBeInstanceOf(Error);
    expect(err.ratio).toBe(0.96);
  });

  // Verify type exports are importable (compile-time check)
  it('should have ToolEntry type available', () => {
    const entry: ToolEntry = { definition: { name: 'test', description: '', inputSchema: { type: 'object' }, riskLevel: 'safe' as const }, instance: {} as any };
    expect(entry.definition.name).toBe('test');
  });
});
