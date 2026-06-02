# Coder Agent

<p align="center">
  <b>An open-source, enterprise-grade CLI agent coding tool</b><br/>
  <em>A Claude Code alternative with multi-provider support, Agent Teams, and a powerful hook system</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-blue" alt="TypeScript" />
  <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen" alt="Node.js >= 18.0.0" />
  <img src="https://img.shields.io/badge/tests-~500%20passed-success" alt="Tests" />
</p>

---

**Coder Agent** is an open-source CLI coding agent that brings enterprise-grade Agent Team orchestration, multi-provider LLM support, and deep extensibility through its hook system. It runs in your terminal, reads and writes code, executes shell commands, and orchestrates multiple AI agents to solve complex engineering tasks — all with fine-grained permission control and comprehensive context management.

---

## Quick Start

```bash
# Prerequisites: Node.js >= 18.0.0 (Node.js >= 22.0.0 recommended), pnpm >= 9.15.0

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Configure your API key
export ANTHROPIC_API_KEY="sk-ant-api03-your-key-here"

# Or store it in ~/.coder/settings.json
cat > ~/.coder/settings.json << 'EOF'
{
  "theme": "dark",
  "model_list": [
    {
      "name": "deepseek/deepseek-v4-pro",
      "model": "deepseek-chat",
      "base_url": "https://api.deepseek.com/anthropic",
      "auth_token_env": "DEEPSEEK_API_KEY",
      "provider": "deepseek"
    },
    {
      "name": "anthropic/claude-sonnet-4-6",
      "model": "claude-sonnet-4-6",
      "base_url": "https://api.anthropic.com/v1",
      "auth_token_env": "ANTHROPIC_API_KEY",
      "provider": "anthropic"
    }
  ],
  "default_model": "deepseek/deepseek-v4-pro"
}
EOF

# Run Coder Agent
node packages/cli/dist/entry.js

# Or install globally
pnpm link --global
coder
```

For a guided setup, run the installer:

```bash
curl -fsSL https://raw.githubusercontent.com/AgenticMatrix/Coder-Agent/main/install.sh | bash
```

---

## Key Features

### 🧠 Intelligent Agent Loop
**ReAct pattern** powered by TypeScript `AsyncGenerator`. Supports real-time streaming, interrupt & resume, user confirmation pauses, and checkpoint recovery. Prevents infinite loops with max-turns, budget cap, token threshold, and duplicate-operation detection.

### 👥 Agent Teams
**Coordinator/Worker pattern** with async `SubagentBus` communication. Spawn sub-agents for exploration, building, code review, and planning. Workers communicate via shared context and task notifications. Supports `TeamCreate`/`TeamDelete` for on-demand team topology.

```bash
# Coordinator mode with 4 workers
coder --coordinator --workers 4 "Fix all TypeScript errors across the codebase"

# Worker mode (joins an existing team)
coder --worker --team my-team-id
```

### 🔌 Multi-Provider
Unified `Provider` interface supporting **Anthropic** (native extended thinking), **OpenAI** (GPT-4o, o4-mini), and **DeepSeek** (R1 reasoning). **Auto Router** automatically selects the optimal model based on task complexity. Hot-swap providers without changing agent logic.

### 🛠️ Built-in Tools
File system (Read, Write, Edit, Glob), search (Grep), shell (Bash), version control (Git), task management (TodoWrite), browser (WebFetch, WebSearch), agent orchestration (AgentSpawn, AgentMessage, AgentStop), system (Skill, Cron, Worktree), and LSP integration. MCP protocol support for community tool extensions.

### 🔐 3-Tier Permission Model
**Plan** (read-only, auto-approved) → **Ask** (prompt user for mutations) → **Auto** (trusted workspace, full authorization). `SAFE` / `MUTATION` / `DESTRUCTIVE` risk levels. PermissionRequest hooks allow third-party approval plugins. Configurable sandbox modes (Docker, local) for shell execution isolation.

### 🪝 Lifecycle Hooks
`SessionStart`, `UserPromptSubmit`, `PreMessage`, `PostMessage`, `PreToolUse`, `PostToolUse`, `Stop`, `PreCompact` — and 19 more event types (27 total). Blockable hooks (PreMessage, PreToolUse) can veto actions. Non-blockable hooks (PostMessage, Notification) fire-and-forget for observability. Shell and JS function handlers.

### 📦 Context Management
**Snip compaction** (drop oldest messages, keep last 30) and **Summarize** (LLM-based compression). **Microcompact** — zero-LLM cleanup on >60min idle sessions. **BudgetStore** — disk offload for large tool outputs (>50KB single, >200KB aggregate). Dynamic system prompt refresh per turn.

### 🧩 Session Fork & Rewind
Full session lifecycle: `create`, `resume`, `fork` from turn N to explore alternatives, `rewind` to a previous turn, `continue` the last session. Auto file-change checkpoints after every Write/Edit. Git stash checkpoints before destructive operations.

```bash
# Resume most recent session
coder --continue

# Resume specific session
coder --resume sess_abc123

# Fork a session from turn 5
coder --fork-session sess_abc123 --fork-turn 5
```

### 🎨 Terminal UI (TUI)
React Ink-based terminal renderer with command palette, model picker, multi-panel views, and full mouse support. Includes a rich set of slash commands accessible via `/` prefix.

#### TUI Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Ctrl+C` | Interrupt agent / exit |
| `Ctrl+L` | Clear screen |
| `Ctrl+R` | Toggle reasoning display |
| `↑` / `↓` | Navigate history |
| `/` | Open slash command palette |

#### Slash Commands

Type `/` during an interactive session to access built-in commands:

| Command | Description |
|---------|-------------|
| `/help` | List all commands and hotkeys |
| `/clear` | Start a new session |
| `/resume` | Resume a prior session |
| `/model` | Change or show the current model |
| `/sessions` | Switch between live TUI sessions |
| `/compress` | Compress the conversation transcript |
| `/branch` | Fork/branch the current session |
| `/usage` | Show session usage stats (tokens, cost) |
| `/agents` | Open the spawn-tree dashboard |
| `/skills` | Browse, inspect, and install skills |
| `/tools` | Enable or disable tools |
| `/rollback` | List, diff, or restore checkpoints |
| `/status` | Show live session info |
| `/quit` | Exit Coder Agent |
| `/init` | Bootstrap a project context file |

---

## Skill System

Coder Agent features a **self-evolving skill system** powered by `SKILL.md` files. Skills are discovered, loaded, and improved automatically through a three-phase lifecycle:

1. **Create** — The agent detects repeated task patterns across sessions and auto-proposes new skills. Users can also manually install skills from the community hub via `/skills install`.

2. **Use** — Skills are loaded at session start via **Progressive Disclosure**: only skill names and descriptions appear in the system prompt. When a task matches a skill's intent, the full `SKILL.md` body is injected into context on-demand, keeping token usage low.

3. **Improve** — After each skill execution, the agent evaluates the outcome. If improvements are detected (shorter execution, fewer turns, fewer errors), the skill is auto-updated. This creates a virtuous cycle where skills compound in quality over time.

Skills are stored in `~/.coder/skills/` and can be managed via:

```bash
/skills list        # List installed skills
/skills browse      # Browse community skills
/skills install     # Install a skill by name or URL
/skills inspect     # Inspect a skill's full definition
/skills search      # Search community skills by keyword
```

Configure skill auto-creation and auto-improvement in `~/.coder/config.yaml`:

```yaml
skills:
  autoCreate: true           # Auto-propose new skills from repeated tasks
  autoImprove: true          # Auto-improve skills after execution
  minRepeatForSkill: 2       # Times a task must repeat before skill creation
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        TUI Layer (@coder/tui)                │
│            React Ink Terminal Renderer + Gateway            │
│                    query-bridge.ts ↔ GatewayEvent            │
└─────────────────────────────────────────────────────────────┘
                                ▲
                                │  AsyncGenerator<QueryMessage>
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                     Agent Loop (core/query.ts)               │
│  while(true): LLM Stream → Tool Execute → Observe → Repeat  │
│  Exit: maxTurns | budget | abort | stopReason ≠ tool_use    │
└──┬──────────┬──────────┬──────────┬──────────┬──────────────┘
   │          │          │          │          │
   ▼          ▼          ▼          ▼          ▼
┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────┐
│Provider│ │Hooks │ │Tools │ │Context│ │Subagent  │
│Adapter│ │System│ │Reg.  │ │Mgmt  │ │Bus       │
└──┬───┘ └──┬───┘ └──┬───┘ └──┬───┘ └────┬─────┘
   │        │        │        │           │
   ▼        ▼        ▼        ▼           ▼
 Anthropic  Shell  File/Sys  Compactor  Worker
 OpenAI   JS Func  Shell/Git BudgetStore  Agents
 DeepSeek         MCP/Ext.  Snip/Summ.
```

### Packages

| Package | Description |
|---------|-------------|
| `@coder/cli` | Terminal entry point, TUI gateway, engine wiring, slash commands |
| `@coder/core` | Agent Loop, QueryEngine, Hooks, Context, Checkpoint, Session, Cron |
| `@coder/shared` | Types, utilities, protocol definitions, config loader |
| `@coder/provider` | Anthropic, OpenAI, DeepSeek adapters + Auto Router |
| `@coder/tools` | Tool system: registry, orchestrator, permission engine |
| `@coder/skills` | SKILL.md discovery, Progressive Disclosure, self-evolution |
| `@coder/mcp` | MCP Client & Server (JSON-RPC 2.0 over stdio) |
| `@coder/tui` | React Ink terminal renderer with Yoga Layout, ANSI processing |
| `teams/` | Team topology definitions and role configurations |

---

## Comparison

| Feature | Coder Agent | Claude Code | Hermes-Agent |
|---------|-----------|-------------|--------------|
| **License** | MIT | Proprietary | MIT |
| **Multi-Provider** | ✅ Anthropic + OpenAI + DeepSeek + Auto | ❌ Anthropic only | ✅ Multi-provider |
| **Agent Teams** | ✅ Coordinator/Worker + SubagentBus | ❌ Single agent | ❌ Single agent |
| **Hook System** | ✅ 27 events, Shell + JS | ⚠️ Limited hooks | ❌ No hooks |
| **Permission Model** | ✅ 3-tier (Plan/Ask/Auto) + Risk | ⚠️ Ask/Auto only | ⚠️ Basic |
| **Context Compaction** | ✅ Snip + Summarize + Microcompact | ✅ Summarize + Archive | ❌ Limited |
| **BudgetStore Disk Offload** | ✅ Per-result + Aggregate | ❌ No | ❌ No |
| **Session Fork/Rewind** | ✅ Fork from any turn | ❌ No | ❌ No |
| **Thinking Support** | ✅ DeepSeek R1 + Claude Extended | ✅ Claude Extended | ❌ Limited |
| **MCP Protocol** | ✅ Full Client + Server | ✅ Client only | ⚠️ Partial |
| **Skill System** | ✅ Self-evolving Skills | ✅ Skills | ❌ No |
| **Sandbox** | ✅ Docker + Local modes | ⚠️ Basic | ❌ No |
| **Cron Scheduler** | ✅ Durable tasks | ✅ Scheduled tasks | ❌ No |
| **Worktree** | ✅ Git worktree isolation | ✅ Git worktree | ❌ No |
| **FTS5 Memory** | ✅ Semantic search | ✅ Memory system | ❌ No |

> **Coder Agent** stands out in enterprise scenarios with its **Agent Teams**, **multi-provider flexibility**, **deep hook system**, and **fine-grained permission control**. If you need a single-agent coding tool, Claude Code is excellent. If you need AI agent orchestration with extensibility, Coder Agent is the right choice.

---

## Configuration

### API Key

Coder Agent primarily uses `ANTHROPIC_API_KEY` for authentication. The legacy `ANTHROPIC_AUTH_TOKEN` is also supported as a fallback.

Priority order for API key resolution:
1. `ANTHROPIC_API_KEY` environment variable
2. `ANTHROPIC_AUTH_TOKEN` environment variable
3. `~/.coder/settings.json` → `env.ANTHROPIC_API_KEY`
4. `~/.coder/settings.json` → `env.ANTHROPIC_AUTH_TOKEN`

```bash
# Recommended: set ANTHROPIC_API_KEY
export ANTHROPIC_API_KEY="sk-ant-api03-..."

# Legacy: ANTHROPIC_AUTH_TOKEN also works
export ANTHROPIC_AUTH_TOKEN="sk-ant-api03-..."
```

For OpenAI or DeepSeek, set the `CODER_PROVIDER` environment variable:

```bash
# Use OpenAI
export CODER_PROVIDER=openai
export OPENAI_API_KEY="sk-..."

# Use DeepSeek with Anthropic-compatible endpoint
export CODER_PROVIDER=anthropic
export ANTHROPIC_API_KEY="sk-..."
export ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"
export ANTHROPIC_MODEL="deepseek-chat"
```

### Configuration File (~/.coder/config.yaml)

For persistent configuration, use `~/.coder/config.yaml`:

```yaml
provider: anthropic
model: claude-sonnet-4-20250514

providers:
  anthropic:
    baseUrl: https://api.anthropic.com
    maxRetries: 3
    timeoutMs: 120000
  openai:
    baseUrl: https://api.openai.com/v1
    maxRetries: 3
    timeoutMs: 120000
  deepseek:
    baseUrl: https://api.deepseek.com/anthropic
    maxRetries: 3
    timeoutMs: 120000

permissions:
  mode: default              # default | accept-edits | bypass
  allowedPaths: []
  deniedPaths: []

maxTurns: 100
contextBudget: 180000
```

You can also use `~/.coder/settings.json` (JSON format) for environment variables:

```json
{
  "theme": "dark",
  "model_list": [
    {
      "name": "claude-sonnet-4-6",
      "model": "claude-sonnet-4-6",
      "base_url": "https://api.anthropic.com/v1",
      "auth_token_env": "ANTHROPIC_API_KEY",
      "provider": "anthropic"
    },
    {
      "name": "deepseek/deepseek-v4-pro",
      "model": "deepseek-chat",
      "base_url": "https://api.deepseek.com/anthropic",
      "auth_token_env": "DEEPSEEK_API_KEY",
      "provider": "deepseek"
    }
  ],
  "default_model": "claude-sonnet-4-6"
}
```

> **Note:** `ANTHROPIC_BASE_URL` can also be configured per-provider in `~/.coder/config.yaml` under the `providers` section, rather than as a global environment variable.

### Hook Configuration

Place hook definitions in `~/.coder/hooks/*.json`:

```json
{
  "event": "PreToolUse",
  "handler": {
    "type": "shell",
    "command": "/usr/local/bin/coder-guard",
    "timeout": 30000
  }
}
```

Supported events: `SessionStart`, `UserPromptSubmit`, `PreMessage`, `PostMessage`, `PreToolUse`, `PostToolUse`, `PostToolBatch`, `Stop`, `StopFailure`, `PreCompact`, `PostCompact`, `PermissionRequest`, `PermissionDenied`, `Notification`, `SubagentStart`, `SubagentStop`, and more.

### Project Configuration (CLAUDE.md)

Place a `CLAUDE.md` file in your project root for project-specific instructions. Coder Agent automatically loads this as context at the start of every session:

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
```

Use `/init` in an interactive session to have Coder Agent auto-generate a `CLAUDE.md` for your project.

---

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests (~500 tests across 41 test files)
pnpm test

# Type check
pnpm type-check

# Lint
pnpm lint

# CI pipeline (lint + type-check + tests + build)
pnpm ci
```

### Package Descriptions

| Package | Description |
|---------|------------|
| `packages/shared` | Shared types, utilities, protocol definitions, config loader |
| `packages/tui` | Terminal rendering framework (React Ink + Yoga Layout) |
| `packages/tools` | Tool system: registry, orchestrator, permission engine |
| `packages/provider` | LLM provider adapters (Anthropic, OpenAI, DeepSeek) + Auto Router |
| `packages/skills` | Skill system: SKILL.md discovery, creation, improvement |
| `packages/mcp` | MCP Client & Server (JSON-RPC 2.0 over stdio) |
| `packages/core` | Core runtime: Agent Loop, QueryEngine, Hooks, Context, Session, Cron |
| `packages/cli` | CLI entry point, TUI gateway, slash commands, engine factory |
| `packages/teams` | Team topology definitions and coordinator/worker strategies |

### Requirements

- **Node.js** >= 18.0.0 (Node.js >= 22.0.0 recommended)
- **pnpm** >= 9.15.0
- **TypeScript** 5.7+
- **macOS** 12+ or **Linux** (for sandbox features)

---

## Documentation

- [Getting Started Guide](./docs/getting-started.md) — installation, basic usage, TUI shortcuts, session management
- [Configuration Reference](./docs/configuration.md) — full config.yaml schema, env vars, permission modes, sandbox setup

---

## License

MIT © Coder Agent Contributors

---

<p align="center">
  <sub>Built with TypeScript, React Ink, and ❤️ by the Coder Agent community</sub>
</p>
