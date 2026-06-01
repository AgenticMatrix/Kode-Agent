# Changelog

## [0.1.0] - Unreleased

### Added

- Initial open-source release of Kode Agent
- Multi-provider LLM support (Anthropic, OpenAI, DeepSeek) with auto-routing
- Agent Teams with Coordinator/Worker pattern and SubagentBus
- 27-event lifecycle hook system (Shell + JS handlers)
- 3-tier permission model (Plan/Ask/Auto) with risk-level classification
- React Ink-based Terminal UI with slash commands
- Session fork/rewind with checkpoint recovery
- Context compaction (Snip + Summarize + Microcompact)
- BudgetStore disk offload for large tool outputs
- Self-evolving skill system with Progressive Disclosure
- MCP protocol support (Client + Server, JSON-RPC 2.0 over stdio)
- Durable Cron scheduler
- Git worktree isolation
- FTS5 memory system with semantic search
- 26+ built-in tools (Read, Write, Edit, Bash, Glob, Grep, Git, WebFetch, WebSearch, etc.)
- Docker sandbox support
- CI pipeline (lint, type-check, test matrix, CodeQL, integration tests)
