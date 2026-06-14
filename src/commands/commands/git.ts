import type { SlashCommand } from '../types.js';

const streamingBusy = 'Agent is currently streaming. Wait for it to finish, then try again.';

export const gitCommands: SlashCommand[] = [
  {
    aliases: ['cm'],
    help: 'auto-generate commit message and commit staged changes',
    name: 'commit',
    usage: '/commit',
    run: (_arg, ctx) => {
      if (ctx.isStreaming) {
        ctx.sys(streamingBusy);
        return;
      }
      ctx.send(
        [
          'Generate a commit message for the staged changes and create the commit. Follow these steps:',
          '1. Run `git status` to understand the current repo state',
          '2. Run `git diff --cached` to see exactly what is staged',
          '3. Run `git diff` to see unstaged changes (if any)',
          '4. Run `git log --oneline -10` to see recent commit message style for this repo',
          '5. Draft a concise commit message that:',
          '   - Uses the same conventions observed in `git log` (prefixes, capitalization, tense)',
          '   - Summarizes the "why" in the body if changes span multiple concerns',
          '   - Is 50 chars or fewer for the subject line',
          '6. Show me the draft message for confirmation',
          '7. After I confirm, run `git commit -m "..."` with the message',
          '',
          'Important: Do NOT use --no-verify or skip hooks. If the commit fails, show the error and let me decide what to do.',
        ].join('\n'),
      );
    },
  },

  {
    aliases: ['cr'],
    help: 'review current branch changes (also try /code-review for PR review)',
    name: 'review',
    usage: '/review',
    run: (_arg, ctx) => {
      if (ctx.isStreaming) {
        ctx.sys(streamingBusy);
        return;
      }
      ctx.send(
        [
          'Review the current branch changes for correctness, bugs, and improvements. Follow these steps:',
          '1. Run `git branch --show-current` to identify the current branch',
          '2. Run `git diff main...HEAD` to see all changes on this branch since diverging from main (three dots for merge-base comparison)',
          '3. Run `git log main..HEAD --oneline` to review the commit history on this branch',
          '4. Also check for any untracked or unstaged changes with `git status`',
          '5. Perform a thorough code review covering:',
          '   - Logic correctness and edge cases',
          '   - Potential bugs (null handling, error paths, race conditions)',
          '   - Design and architecture issues',
          '   - Performance concerns',
          '   - Security issues (injection, secrets, auth)',
          '   - Test coverage gaps',
          '   - Code duplication and reusability',
          '6. Organize findings by severity (critical / high / medium / low)',
          '7. For each finding, include the file path, line range, the issue, and a suggested fix',
        ].join('\n'),
      );
    },
  },

  {
    aliases: ['pull-request'],
    help: 'create a pull request for the current branch (uses gh CLI)',
    name: 'pr',
    usage: '/pr [title or description hint]',
    run: (arg, ctx) => {
      if (ctx.isStreaming) {
        ctx.sys(streamingBusy);
        return;
      }

      const hint = arg.trim();
      const hintLine = hint
        ? `Use "${hint}" as context for the PR title and description.`
        : '';

      ctx.send(
        [
          'Create a pull request for the current branch. Follow these steps:',
          '1. Run `git branch --show-current` to identify the branch',
          '2. Run `gh auth status` to verify gh CLI is authenticated',
          '3. Run `git log main..HEAD --oneline` to understand the full commit history',
          '4. Run `git diff main...HEAD --stat` to see the scope of changes',
          '5. Run `gh pr list --head $(git branch --show-current) --state open` to check for existing PRs',
          '6. Push the branch if not already pushed: `git push -u origin HEAD`',
          '7. Draft a PR title (concise, under 70 chars) and body with:',
          '   - A ## Summary section (1-3 bullet points)',
          '   - A ## Test plan section (checkbox checklist)',
          hintLine,
          '8. Show me the draft title and body for confirmation',
          '9. After I confirm, run `gh pr create --title "..." --body "..."`',
          '',
          'Important: Review ALL commits (not just the latest one) when drafting the PR description. Use gh CLI for all PR operations.',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    },
  },
];
