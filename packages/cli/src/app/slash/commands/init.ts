import type { SlashCommand } from '../types.js'

/**
 * /init — Bootstrap a project context file (.kode/KODE.md)
 *
 * Sends a structured prompt to the Agent asking it to:
 * 1. Analyse the project structure (package.json, tsconfig, directory layout)
 * 2. Generate a tailored .kode/KODE.md with project description, tech stack,
 *    build commands, coding conventions, and architecture notes
 * 3. Write the file to .kode/KODE.md and report what was created
 */
export const initCommands: SlashCommand[] = [
  {
    help: 'bootstrap a project context file (.kode/KODE.md)',
    name: 'init',
    run: (_arg, ctx) => {
      // If the agent is busy mid-turn, queue the prompt so it fires
      // after the current turn completes rather than interrupting.
      if (ctx.ui.busy) {
        ctx.composer.enqueue(INIT_PROMPT)
        ctx.transcript.sys(
          'agent is busy — /init prompt queued (run /queue to inspect, Ctrl+K to dispatch)'
        )
        return
      }

      // Submit directly to the agent (automatically creates a session if none exists)
      ctx.transcript.send(INIT_PROMPT)
    }
  }
]

/** The prompt sent to the Agent by /init. */
const INIT_PROMPT = [
  'Please analyse the current project and create a `.kode/KODE.md` file.',
  '',
  'Steps:',
  '1. Read `package.json` (if it exists) — note the project name, scripts, dependencies.',
  '2. Read `tsconfig.json` or `jsconfig.json` — note compiler options and path aliases.',
  '3. List the top-level directory structure (Glob "**/*" with depth 1-2 or use Bash `ls -la`).',
  '4. Check for existing config files: `.eslintrc.*`, `.prettierrc*`, `vite.config.*`, etc.',
  '5. Check `.gitignore` for build-output patterns.',
  '',
  'Then generate `.kode/KODE.md` with these sections:',
  '',
  '```markdown',
  '# Project: <name from package.json>',
  '',
  '## Tech Stack',
  '- Runtime: <Node.js/Python/etc>',
  '- Framework: <React/Vue/Express/etc>',
  '- Key dependencies: <list 5-8 important ones>',
  '',
  '## Project Layout',
  '```',
  '<directory tree with brief annotations>',
  '```',
  '',
  '## Build & Run',
  '```bash',
  '<install command>',
  '<build command>',
  '<dev server command>',
  '<test command>',
  '```',
  '',
  '## Coding Conventions',
  '- <TypeScript strict? ESLint rules? Prettier config?>',
  '- <Naming conventions inferred from existing code>',
  '- <Import ordering / path aliases>',
  '',
  '## Architecture Notes',
  '- <monorepo? packages? key modules?>',
  '- <API layer pattern? database?>',
  '',
  '## Common Tasks',
  '- <how to add a new feature>',
  '- <how to run tests for a specific file>',
  '```',
  '',
  'Write the file using the Write tool. After writing, summarise what you created.',
  '',
  'Important:',
  '- Keep descriptions concise — this is a reference for future Agent sessions.',
  '- Use the actual project structure you observe, not templates.',
  '- If a section does not apply (e.g. no database), omit it.',
  '- The file path must be `.kode/KODE.md` in the project root.'
].join('\n')
