/**
 * @kode/core — Kode Agent core runtime
 *
 * Phase 1: Agent Loop, QueryEngine, Session, Checkpoint, Permission, System Prompt
 * Phase 2: Hooks, Context Management, Sub-Agents
 */

// --- Agent Loop ---
export { query } from './query.js';
export type { QueryConfig, CallModelParams } from './query.js';

// --- QueryEngine ---
export { QueryEngine } from './query-engine.js';
export type { QueryEngineConfig, QueryEngineEvent } from './query-engine.js';

// --- Tool Registry ---
export { ToolRegistry } from './tool-registry.js';
export type { ToolEntry, ToolCategory } from './tool-registry.js';

// --- Session ---
export { SessionManager } from './session.js';

// --- Checkpoint ---
export { CheckpointManager } from './checkpoint.js';
export type { Checkpoint, CheckpointCreateOptions, CheckpointRestoreResult } from './checkpoint.js';

// --- Permission ---
export { PermissionEngine, classifyTaskMode } from './permission/engine.js';
export type { ClassificationContext } from './permission/engine.js';

// --- System Prompt ---
export { SystemPromptAssembler } from './system-prompt/assembler.js';
export type { PromptPart, AssemblyContext, SystemPrompt } from './system-prompt/assembler.js';
export { getCoordinatorPrompt } from './system-prompt/coordinator.js';

// --- Rules Manager (Phase 5) ---
export { RuleManager } from './rules-manager.js';
export type { RuleFile, ActiveRulesContext } from './rules-manager.js';

// --- Error Recovery ---
export {
  classifyError,
  computeBackoff,
  delay,
  withRetry,
  MaxTurnsExceededError,
  BudgetExceededError,
  StopRequestedError,
  FatalAPIError,
  ContextOverflowError,
} from './error-recovery.js';
export type { ErrorCategory, ClassifiedError, RetryConfig } from './error-recovery.js';

// --- Provider Adapter ---
export {
  createCallModelFromProvider,
  createCallModelFromConfig,
  resetAdapterState,
} from './provider-adapter.js';

// --- Memory System ---
export {
  MemoryType,
  createMemoryStore,
  JsonMemoryStore,
  MemoryExtractor,
  MemoryConsolidator,
  extractKeywords,
  extractMemories,
  consolidateStore,
} from './memory/index.js';
export type {
  Memory,
  MemoryQuery,
  MemoryInput,
  MemorySearchResult,
  IMemoryStore,
  ExtractionResult,
  ExtractionOptions,
  ConsolidationResult,
  ConsolidationOptions,
  MergeDetail,
} from './memory/index.js';

// --- Subagent Bus (re-exported from shared) ---
export {
  SubagentBus,
  getSubagentBus,
  setSubagentBus,
  resetSubagentBus,
  formatTaskNotification,
} from '@kode/shared';
export type {
  SubagentEntry,
  SubagentStatus,
  SubagentSpawnOptions,
  SubagentSpawnConfig,
  SubagentBusConfig,
  RunAgentCallback,
  CompletedSubagent,
} from '@kode/shared';

// --- Agent Teams (re-exported from shared) ---
export {
  WorkerRole,
  ROLE_TOOLS,
  WORKER_ROLES,
  getDefaultToolsForRole,
  isValidWorkerRole,
  isCoordinatorRole,
} from '@kode/shared';
export type { WorkerConfig } from '@kode/shared';

// --- Subagent Bus (core-side engine integration) ---
export { createRunAgentCallback, createForkAgentCallback } from './subagent-bus.js';
export type { CreateRunAgentOptions, CreateForkAgentOptions } from './subagent-bus.js';

// --- Hooks ---
export { HookManager } from './hooks/manager.js';
export {
  createEmptyAggregatedResult,
  aggregateHookResults,
} from './hooks/types.js';
export type {
  HookExecutionResult,
  AggregatedHookResult,
} from './hooks/types.js';

// --- Scratchpad ---
export { Scratchpad, getScratchpad, setScratchpad } from './scratchpad.js';
export type { VersionEntry } from './scratchpad.js';

// --- Context Management ---
export { Compactor, DEFAULT_COMPACTOR_CONFIG } from './context/compactor.js';
export type {
  CompactStrategy,
  CompactorConfig,
  CompactResult,
  MicrocompactStrategy,
  MicrocompactResult,
} from './context/compactor.js';
export { MICROCOMPACT_IDLE_THRESHOLD_MS, MICROCOMPACT_KEEP_RECENT_TOOL_TURNS } from './context/compactor.js';
export type { TokenBudget as CompactorTokenBudget } from './context/compactor.js';
export {
  estimateTokens,
  estimateStringTokens,
  estimateBlockTokens,
  estimateMessageTokens,
  createTokenBudget,
  createTokenBudgetFromCount,
  isBudgetExceeded,
  needsCompaction,
} from './context/token-budget.js';
export type { TokenBudget } from './context/token-budget.js';

// --- Tool Result Budget ---
export { BudgetStore } from './budget-store.js';
export type { BudgetEntry, MaybeOffloadResult } from './budget-store.js';

// --- Cron Scheduler ---
export {
  CronScheduler,
  getCronScheduler,
  setCronScheduler,
  resetCronScheduler,
} from './cron-scheduler.js';
export type { CronSchedulerConfig, CronFireCallback, ScheduledTask } from './cron-scheduler.js';
