import type { SlashCommand } from '../types.js';
import { listTasks, getTask, getAgentStatuses } from '../../tasks/store.js';

export const tasksCommand: SlashCommand = {
  name: 'tasks',
  aliases: ['t'],
  help: 'list all tasks or show task details (/tasks [id|agent-status])',
  usage: '/tasks [task-id|agent-status]',
  run(arg, ctx) {
    const trimmed = arg.trim();

    if (trimmed === 'agent-status') {
      void (async () => {
        try {
          const statuses = await getAgentStatuses();
          if (statuses.length === 0) {
            ctx.sys('No agents have owned any tasks yet.');
            return;
          }
          const lines = ['Agent task status:', ''];
          for (const s of statuses) {
            const icon = s.status === 'busy' ? '●' : '○';
            const tasks = s.currentTasks.length > 0
              ? ` tasks: ${s.currentTasks.map(id => `#${id}`).join(', ')}`
              : '';
            lines.push(`  ${icon} ${s.name} [${s.status}]${tasks}`);
          }
          ctx.sys(lines.join('\n'));
        } catch (err) {
          ctx.sys(`Error: ${(err as Error).message}`);
        }
      })();
      return;
    }

    if (trimmed) {
      // Show specific task
      void (async () => {
        try {
          const task = await getTask(trimmed);
          if (!task) {
            ctx.sys(`Task #${trimmed} not found.`);
            return;
          }
          const lines = [
            `Task #${task.id}`,
            `  Subject:     ${task.subject}`,
            `  Status:      ${task.status}`,
            `  Description: ${task.description}`,
          ];
          if (task.activeForm) lines.push(`  Active form: ${task.activeForm}`);
          if (task.owner) lines.push(`  Owner:       ${task.owner}`);
          if (task.blocks.length) lines.push(`  Blocks:      ${task.blocks.map(id => `#${id}`).join(', ')}`);
          if (task.blockedBy.length) lines.push(`  Blocked by:  ${task.blockedBy.map(id => `#${id}`).join(', ')}`);
          lines.push(`  Created:     ${new Date(task.createdAt).toLocaleString()}`);
          lines.push(`  Updated:     ${new Date(task.updatedAt).toLocaleString()}`);
          ctx.sys(lines.join('\n'));
        } catch (err) {
          ctx.sys(`Error: ${(err as Error).message}`);
        }
      })();
      return;
    }

    // List all tasks
    void (async () => {
      try {
        const tasks = await listTasks();
        if (tasks.length === 0) {
          ctx.sys('No tasks in the task list.');
          return;
        }

        const lines = [`${tasks.length} task(s):`, ''];
        for (const task of tasks) {
          const icon =
            task.status === 'completed' ? '✓' :
            task.status === 'in_progress' ? '⟳' : '○';
          const owner = task.owner ? ` [${task.owner}]` : '';
          const deps: string[] = [];
          if (task.blockedBy.length) deps.push(`waiting: ${task.blockedBy.map(id => `#${id}`).join(',')}`);
          if (task.blocks.length) deps.push(`blocks: ${task.blocks.map(id => `#${id}`).join(',')}`);
          const depInfo = deps.length ? ` (${deps.join('; ')})` : '';
          lines.push(`  ${icon} #${task.id} ${task.subject}${owner}${depInfo}`);
        }

        // Summary
        const pending = tasks.filter(t => t.status === 'pending').length;
        const inProgress = tasks.filter(t => t.status === 'in_progress').length;
        const completed = tasks.filter(t => t.status === 'completed').length;
        lines.push('');
        lines.push(`Pending: ${pending}  In progress: ${inProgress}  Completed: ${completed}`);

        ctx.sys(lines.join('\n'));
      } catch (err) {
        ctx.sys(`Error: ${(err as Error).message}`);
      }
    })();
  },
};
