# Configuration Reference

Kode Agent is configured through a combination of `~/.kode/config.yaml`,
environment variables, and CLI flags.

## Config File

The primary configuration file lives at `~/.kode/config.yaml`. It is created
automatically on first run if it doesn't exist.

### Full Schema

```yaml
# ── Provider ──────────────────────────────────────────────────────────────
provider: deepseek             # deepseek | anthropic | openai
model: deepseek-v4-pro

# ── Provider-specific settings ────────────────────────────────────────────
providers:
  anthropic:
    baseUrl: https://api.anthropic.com
    maxRetries: 3
    timeoutMs: 120000
  deepseek:
    baseUrl: https://api.deepseek.com/v1
    maxRetries: 3
    timeoutMs: 120000
  openai:
    baseUrl: https://api.openai.com/v1
    maxRetries: 3
    timeoutMs: 120000

# ── Agent Behavior ────────────────────────────────────────────────────────
maxTurns: 100                # Maximum turns per query
contextBudget: 180000        # Token budget before auto-compaction
compactThreshold: 0.7        # Fraction of budget that triggers compaction

# ── Permissions ───────────────────────────────────────────────────────────
permissions:
  mode: default              # default | accept-edits | bypass
  allowedPaths: []           # Paths the agent can always write to
  deniedPaths: []            # Paths the agent can never touch
  allowShellCommands: true   # Whether shell execution is permitted

# ── Sessions ──────────────────────────────────────────────────────────────
sessions:
  maxSessions: 50            # Maximum stored sessions before rotation
  autoResume: true           # Auto-resume last session on kode (no args)

# ── Skills ────────────────────────────────────────────────────────────────
skills:
  autoCreate: true           # Auto-propose new skills from repeated tasks
  autoImprove: true          # Auto-improve skills after execution
  minRepeatForSkill: 2       # Times a task must repeat before skill creation

# ── Sandbox ───────────────────────────────────────────────────────────────
sandbox:
  mode: docker               # docker | local | disabled
  image: kode-agent/sandbox  # Sandbox Docker image
  networkDisabled: true      # Disable network in sandbox
  readOnlyRootfs: true       # Read-only filesystem (except workspace)

# ── Telemetry ─────────────────────────────────────────────────────────────
telemetry:
  enabled: false
  endpoint: https://telemetry.kode.dev
```

## Environment Variables

All configuration options can be overridden with environment variables.
Environment variables take precedence over the config file.

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key | — |
| `DEEPSEEK_API_KEY` | DeepSeek API key | — |
| `OPENAI_API_KEY` | OpenAI API key | — |
| `KODE_PROVIDER` | LLM provider name | `anthropic` |
| `KODE_MODEL` | Model identifier | provider default |
| `KODE_MAX_TURNS` | Maximum turns per query | `100` |
| `KODE_CONTEXT_BUDGET` | Token budget before compaction | `180000` |
| `KODE_COMPACT_THRESHOLD` | Compaction trigger threshold | `0.7` |
| `KODE_PERMISSION_MODE` | Permission mode | `default` |
| `KODE_SANDBOX_MODE` | Sandbox mode | `docker` |
| `KODE_SANDBOX_IMAGE` | Sandbox Docker image | `kode-agent/sandbox` |
| `KODE_SESSION_DIR` | Session storage directory | `~/.kode/sessions` |
| `KODE_SKILLS_DIR` | Skills storage directory | `~/.kode/skills` |
| `KODE_SCRATCHPAD_DIR` | Scratchpad directory | `~/.kode/scratchpad` |
| `KODE_TELEMETRY_ENABLED` | Enable telemetry | `false` |
| `KODE_COORDINATOR_MODE` | Force coordinator mode | `false` |
| `KODE_WORKER_MODE` | Force worker mode | `false` |
| `KODE_TEAM_ID` | Team identifier for multi-agent | — |
| `KODE_DEBUG` | Enable debug logging | `false` |
| `KODE_HEAPDUMP_ON_START` | Write heap dump at startup | `false` |

## Provider Configuration

### Anthropic (Default)

```bash
export ANTHROPIC_API_KEY=sk-ant-api03-...
```

Supported models:
- `claude-opus-4-20250514` — most capable
- `claude-sonnet-4-20250514` — balanced
- `claude-haiku-3-5-20241022` — fastest

### DeepSeek

```bash
export DEEPSEEK_API_KEY=sk-...
```

```yaml
provider: deepseek
model: deepseek-chat
```

### OpenAI

```bash
export OPENAI_API_KEY=sk-...
```

```yaml
provider: openai
model: gpt-4o
```

### Custom Provider (OpenAI-compatible)

```yaml
providers:
  custom:
    baseUrl: https://your-llm-proxy.com/v1
    apiKeyEnv: CUSTOM_API_KEY
    maxRetries: 3
    timeoutMs: 120000
```

Set `provider: custom` and `model: your-model-name`.

## Permission Modes

### `default` (Recommended)

The agent asks for permission before:
- Writing or deleting files
- Executing shell commands
- Making network requests (in sandbox-disabled mode)

### `accept-edits`

Auto-approves file edits and safe operations. Still prompts for:
- Shell commands
- File deletions outside the project

### `bypass`

No permission prompts. Use with caution — the agent can execute arbitrary
commands and modify any file within its allowed paths.

### Path-Based Rules

Fine-grained control with `allowedPaths` and `deniedPaths`:

```yaml
permissions:
  mode: default
  allowedPaths:
    - src/**/*.ts
    - tests/**/*.test.ts
  deniedPaths:
    - .env
    - .env.*
    - secrets/**
    - **/credentials.*
```

## Session Storage

Sessions are stored as JSON files in `~/.kode/sessions/` (configurable via
`KODE_SESSION_DIR`). Each session file contains:

```json
{
  "id": "sess_abc123",
  "cwd": "/path/to/project",
  "createdAt": "2026-05-30T10:00:00Z",
  "updatedAt": "2026-05-30T10:05:00Z",
  "messages": [
    { "role": "user", "content": "Fix the login bug" },
    { "role": "assistant", "content": [...] }
  ],
  "checkpoints": [
    { "turn": 0, "messageIndex": 2 }
  ],
  "totalCost": 0.042,
  "totalTokens": 15000
}
```

### Session Commands

```bash
# List recent sessions
kode --sessions

# Resume a specific session
kode --resume sess_abc123

# Continue the most recent session
kode --continue
```

## Sandbox Configuration

Kode Agent can execute code and shell commands in an isolated Docker container.

### Docker Sandbox (Default)

```yaml
sandbox:
  mode: docker
  image: kode-agent/sandbox:latest
  networkDisabled: true
  readOnlyRootfs: true
  workspaceMount: /workspace
```

The sandbox image is a minimal Linux container with:
- Node.js 22 runtime
- Python 3.12
- Git, curl, jq
- Common build tools (make, gcc)

### Local Execution

```yaml
sandbox:
  mode: local
```

Commands run directly on the host. Faster but no isolation.

### Disabled

```yaml
sandbox:
  mode: disabled
```

No code execution. The agent can only read and edit files.

## Thinking (Extended Reasoning)

Enable extended thinking for complex tasks:

```bash
kode --thinking "Design the database schema for a multi-tenant SaaS"
```

Control the thinking budget (in tokens):

```bash
kode --thinking --thinking-budget 4096 "Architect the microservices"
```

## Advanced

### Custom System Prompt

Append instructions to the system prompt:

```yaml
appendSystemPrompt: |
  Always use TypeScript strict mode.
  Prefer functional components over class components.
  Write tests for all new code.
```

Or override entirely:

```yaml
customSystemPrompt: |
  You are a security auditor. Focus on finding vulnerabilities.
  Do not suggest features or refactoring.
```

### Context Compaction

When the conversation exceeds the `contextBudget`, the engine automatically
summarizes earlier messages to stay within limits. The `compactThreshold`
controls how aggressively this happens (0.0 = never compact, 1.0 = compact
at exactly the budget).

```yaml
contextBudget: 180000      # 180K tokens
compactThreshold: 0.7      # Start compacting at 126K tokens
```

### Multiple Projects

Configuration is global (`~/.kode/config.yaml`), but project-specific
instructions go in `KODE.md` at the project root. The agent reads this
file at the start of every session.
