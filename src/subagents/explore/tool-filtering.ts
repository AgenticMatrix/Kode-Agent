/** Whitelist of tools available to explore-type async sub-agents. */
export const ASYNC_AGENT_ALLOWED_TOOLS = new Set([
  'bash',
  'read',
  'write',
  'edit',
  'glob',
  'grep',
  'web-fetch',
  'web-search',
  'todo-write',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
  'Skill',
  'NotebookEdit',
]);
