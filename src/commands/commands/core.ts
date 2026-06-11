import type { SlashCommand } from '../types.js';

export const coreCommands: SlashCommand[] = [
  {
    aliases: ['h'],
    help: 'list available commands',
    name: 'help',
    run: (_arg, ctx) => {
      const lines = [
        'Available commands:',
        '',
        '  /help          List available commands',
        '  /quit, /exit   Exit the application',
        '  /clear, /new   Start a new conversation',
        '  /model [name]  Show or change the model',
        '  /compact       Trigger conversation compaction',
        '  /status        Show session status',
        '  /undo          Undo last exchange',
        '  /retry         Retry last user message',
        '  /verbose       Cycle verbose tool output mode',
        '  /statusbar     Toggle status bar (top/off)',
        '',
        'Hotkeys:',
        '  Enter          Send message',
        '  Esc            Clear input',
        '  Ctrl+E         Toggle thinking display',
        '  ← → Home End   Cursor movement',
        '  Backspace/Del  Delete character',
      ];
      ctx.sys(lines.join('\n'));
    },
  },

  {
    aliases: ['exit'],
    help: 'exit the application',
    name: 'quit',
    run: (_arg, ctx) => {
      ctx.sys('Goodbye.');
      ctx.exit();
    },
  },

  {
    aliases: ['new'],
    help: 'start a new conversation',
    name: 'clear',
    run: (_arg, ctx) => {
      ctx.dispatch({ type: 'CLEAR_CHAT' });
      ctx.sys('Starting a new conversation.');
    },
  },

  {
    help: 'show or change the current model',
    name: 'model',
    usage: '/model [model-name]',
    run: (arg, ctx) => {
      if (!arg.trim()) {
        ctx.sys(`Current model: ${ctx.model}`);
        return;
      }
      ctx.sys(`Model changed to: ${arg.trim()}`);
    },
  },

  {
    help: 'show session status',
    name: 'status',
    run: (_arg, ctx) => {
      ctx.sys(
        [
          `Model: ${ctx.model}`,
          `Streaming: ${ctx.isStreaming ? 'yes' : 'no'}`,
          `Input: ${ctx.inputText ? `${ctx.inputText.length} chars` : 'empty'}`,
        ].join('\n'),
      );
    },
  },

  {
    help: 'compact the conversation context',
    name: 'compact',
    run: (_arg, ctx) => {
      ctx.sys('Compacting conversation... (context optimization triggered)');
    },
  },

  {
    help: 'undo the last exchange',
    name: 'undo',
    run: (_arg, ctx) => {
      ctx.sys('Undo requested — last exchange will be reverted.');
    },
  },

  {
    help: 'retry the last user message',
    name: 'retry',
    run: (_arg, ctx) => {
      ctx.sys('Retrying last message...');
    },
  },

  {
    help: 'cycle verbose tool output mode',
    name: 'verbose',
    run: (_arg, ctx) => {
      ctx.sys('Verbose mode toggled.');
    },
  },

  {
    aliases: ['sb'],
    help: 'toggle status bar (on|off)',
    name: 'statusbar',
    usage: '/statusbar [on|off]',
    run: (arg, ctx) => {
      const mode = arg.trim().toLowerCase();
      const next = mode === 'off' ? 'off' : 'top';
      ctx.sys(`Status bar: ${next}`);
    },
  },

  {
    aliases: ['subagent'],
    help: 'view sub-agent transcript',
    name: 'agent',
    usage: '/agent [agent-id]',
    run: (arg, ctx) => {
      const agentId = arg.trim();
      if (!agentId) {
        ctx.dispatch({ type: 'SHOW_AGENT_PICKER' });
        return;
      }
      ctx.dispatch({ type: 'OPEN_SUBAGENT_VIEW', agentId });
    },
  },
];
