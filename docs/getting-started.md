# Getting Started with Coder Agent

Coder Agent is a terminal-native AI coding agent that understands your codebase and
executes multi-step engineering tasks. It supports both single-agent and
coordinator/worker modes.

## Prerequisites

- **Node.js >= 18** (Node 22+ recommended)
- **pnpm** (for development installs)
- An API key from at least one provider:
  - [Anthropic Console](https://console.anthropic.com/) (default)
  - [DeepSeek Platform](https://platform.deepseek.com/)
  - [OpenAI Platform](https://platform.openai.com/)

## Installation

### One-Click Install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/AgenticMatrix/Coder-Agent/main/install.sh | bash
```

The installer will:
1. Verify your Node.js version
2. Install `coder-agent` globally via npm
3. Create `~/.coder/` with session storage and skill directories
4. Prompt you to configure your Anthropic API key

### npm

```bash
npm install -g coder-agent
```

### From Source

```bash
git clone https://github.com/AgenticMatrix/Coder-Agent.git
cd coder-agent
pnpm install
pnpm build
pnpm link --global
```

## Configuration

### API Keys

Coder Agent supports multiple LLM providers. Set at least one:

```bash
# Anthropic (default)
export ANTHROPIC_API_KEY=sk-ant-...

# DeepSeek
export DEEPSEEK_API_KEY=sk-...

# OpenAI
export OPENAI_API_KEY=sk-...
```

Add the export to your shell config (`~/.zshrc` or `~/.bashrc`) to persist
across terminal sessions.

### Provider Selection

Set the provider and model in `~/.coder/config.yaml`:

```yaml
provider: deepseek
model: deepseek-v4-pro
```

Or via environment variables:

```bash
export CODER_PROVIDER=deepseek
export CODER_MODEL=deepseek-chat
```

See [Configuration](./configuration.md) for all options.

## Basic Usage

### Interactive Session

Start an interactive TUI session in your project directory:

```bash
cd my-project
coder
```

The Terminal UI shows:
- The conversation with the agent
- Tool calls and their results
- Permission prompts for file writes and shell commands
- Session cost and token usage

### One-Shot Query

Ask a single question without entering interactive mode:

```bash
coder "Explain the authentication flow in this project"
```

### Coordinator Mode

Run a coordinator that delegates work to parallel worker agents:

```bash
coder --coordinator "Fix all TypeScript errors across the codebase"
```

Control the number of workers:

```bash
coder --coordinator --workers 4 "Write tests for all untested modules"
```

### Resume a Session

```bash
# Resume the most recent session
coder --continue

# Resume a specific session by ID
coder --resume sess_abc123
```

### Fork a Session

Create a new session from a previous conversation at a specific turn:

```bash
coder --fork-session sess_abc123 --fork-turn 5
```

## Project Instructions — CODER.md

Create a `CODER.md` file at the root of your project to give the agent
project-specific context. This file is read automatically at the start of every
session. (Also supports `CLAUDE.md` and `CODEBUDDY.md` for compatibility.)

```markdown
# Project Overview

This is a Next.js e-commerce application with Prisma ORM and PostgreSQL.

## Architecture

- `src/app/` — Next.js App Router pages
- `src/components/` — Shared React components
- `src/lib/` — Utilities and business logic
- `prisma/` — Database schema and migrations

## Conventions

- Use TypeScript strict mode
- Tests use Vitest with React Testing Library
- API routes follow RESTful conventions
- Commit messages follow Conventional Commits

## Environment

- Node 20+
- PostgreSQL 16
- Redis for session caching
```

## Session Management

Sessions are stored in `~/.coder/sessions/` as JSON files. Each session contains:
- The full message transcript
- Checkpoints at each turn boundary
- Tool usage history
- Cost and token tracking

## Keyboard Shortcuts (TUI)

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Ctrl+C` | Interrupt agent / exit |
| `Ctrl+L` | Clear screen |
| `Ctrl+R` | Toggle reasoning display |
| `↑` / `↓` | Navigate history |

## Permissions

Coder Agent asks for permission before executing file writes or shell commands.
You can configure the permission mode:

```bash
# Always ask (default)
coder --permission default

# Auto-accept safe operations
coder --permission accept-edits

# Bypass all prompts (use with caution)
coder --permission bypass
```

## Next Steps

- [Configuration Reference](./configuration.md) — all config options
