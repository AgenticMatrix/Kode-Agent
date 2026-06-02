/**
 * @coder/tools — Barrel export for all Coder Agent tools.
 *
 * Each tool is exported as a class. Use with @coder/core ToolRegistry.
 */

// Tool implementations
export { BashTool } from './bash.js';
export type { BashInput, BashOutput } from './bash.js';

export { ReadTool } from './read.js';
export type { ReadInput, ReadOutput, TextOutput, ImageOutput } from './read.js';

export { WriteTool } from './write.js';
export type { WriteInput, WriteOutput } from './write.js';

export { EditTool } from './edit.js';
export type { EditInput, EditOutput } from './edit.js';

export { GlobTool } from './glob.js';
export type { GlobInput, GlobOutput } from './glob.js';

export { GrepTool } from './grep.js';
export type { GrepInput, GrepOutput, GrepMatch } from './grep.js';

export { GitTool } from './git.js';
export type { GitInput, GitOutput } from './git.js';

export { TodoWriteTool } from './todo-write.js';
export type { TodoWriteInput, TodoWriteOutput, TodoItem, TodoStatus } from './todo-write.js';

export { TaskCreateTool } from './task-create.js';
export type { TaskCreateInput, TaskCreateOutput } from './task-create.js';

export { TaskUpdateTool } from './task-update.js';
export type { TaskUpdateInput, TaskUpdateOutput } from './task-update.js';

export { WebFetchTool } from './web-fetch.js';
export type { WebFetchInput, WebFetchOutput } from './web-fetch.js';

export { WebSearchTool } from './web-search.js';
export type { WebSearchInput, WebSearchOutput, SearchResult } from './web-search.js';

export { AskUserQuestionTool, pendingQuestions, resolveQuestions, cancelQuestions, getPendingRequestIds, getPendingQuestion } from './ask-user-question.js';
export type { AskUserQuestionInput, AskUserQuestionOutput, Question, QuestionOption } from './ask-user-question.js';

export { TaskListTool } from './task-list.js';
export type { TaskListInput, TaskListOutput, TaskListItem } from './task-list.js';

export { TaskDescribeTool } from './task-describe.js';
export type { TaskDescribeInput, TaskDescribeOutput } from './task-describe.js';

export { TaskOutputTool } from './task-output.js';
export type { TaskOutputInput, TaskOutputOutput } from './task-output.js';

export { ExitPlanModeTool } from './exit-plan-mode.js';
export type { ExitPlanModeInput, ExitPlanModeOutput } from './exit-plan-mode.js';

export { AgentReadTool } from './agent-read.js';
export type { AgentReadInput, AgentReadOutput } from './agent-read.js';

export { AgentMessageTool } from './agent-message.js';
export type { AgentMessageInput, AgentMessageOutput } from './agent-message.js';

export { AgentStopTool } from './agent-stop.js';
export type { AgentStopInput, AgentStopOutput } from './agent-stop.js';

export { AgentSpawnTool } from './agent-spawn.js';
export type { AgentSpawnInput, AgentSpawnOutput, SubagentType } from './agent-spawn.js';

export { SkillTool, setSkillRegistryAccessor } from './skill.js';
export type { SkillInput, SkillOutput } from './skill.js';

export { TeamCreateTool } from './team-create.js';
export type { TeamCreateInput, TeamCreateOutput, TeamWorkerConfig, TeamConfig } from './team-create.js';

export { TeamDeleteTool } from './team-delete.js';
export type { TeamDeleteInput, TeamDeleteOutput } from './team-delete.js';

export { NotebookEditTool } from './notebook-edit.js';
export type { NotebookEditInput, NotebookEditOutput, CellType, EditMode } from './notebook-edit.js';

export { LSPTool } from './lsp.js';
export type { LSPInput, LSPOutput, Diagnostic, HoverInfo, DefinitionInfo, LSPAction } from './lsp.js';

export { CronCreateTool } from './cron-create.js';
export type { CronCreateInput, CronCreateOutput, ScheduledTask } from './cron-create.js';

export { CronDeleteTool } from './cron-delete.js';
export type { CronDeleteInput, CronDeleteOutput } from './cron-delete.js';

export { CronListTool } from './cron-list.js';
export type { CronListInput, CronListOutput } from './cron-list.js';

export { EnterWorktreeTool } from './enter-worktree.js';
export type { EnterWorktreeInput, EnterWorktreeOutput } from './enter-worktree.js';

export { ExitWorktreeTool } from './exit-worktree.js';
export type { ExitWorktreeInput, ExitWorktreeOutput } from './exit-worktree.js';

// Re-export base types from shared
export {
  BaseTool,
  RiskLevel,
  type ToolDefinition,
  type ToolContext,
  type ValidationResult,
  type ToolExecutionResult,
} from '@coder/shared';
