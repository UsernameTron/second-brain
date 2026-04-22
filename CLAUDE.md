# Second Brain — Claude Code Project

## Project Overview

Obsidian vault serving as Pete Connor's second brain. Hybrid architecture inspired by Cole Medin + Eric Michaud: memory layer, proactive heartbeat, left/right vault split.

## Architecture

- **Left vault**: Identity, context, reference material (ABOUT ME/)
- **Right vault**: Active work, memory promotion, daily output
- **Memory layer**: Compounding `memory.md` updated daily
- **Heartbeat**: `/today` produces daily prep list

## Vault Rules

- This is a vault-as-project: Obsidian content IS the project
- Never surface ISPN, Genesys, or Asana content in memory promotion
- All executive deliverables use Obsidian dark-mode aesthetic
- Follow anti-AI writing style guide in all vault content

## Commands

| Command | Purpose |
|---------|---------|
| `/today` | Daily prep list |
| `/new` | Route mixed input to correct location |

## Tech Stack

- Obsidian vault (markdown)
- Claude Code for orchestration
- GSD framework for project management

## Test Coverage

N/A — knowledge project, not code project.

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Second Brain**

A project that orchestrates an Obsidian vault into Pete Connor's personal operating system — compounding memory, proactive daily briefing, and intelligent input routing. The project code and GSD state live at ~/projects/second-brain/; the vault lives at ~/Claude Cowork/; they couple through the Obsidian MCP gateway. Built on a left/right write-permission architecture where human voice is preserved on one side and agent-generated content lives on the other. Integrates Gmail, Google Calendar, GitHub, and cross-project GSD state into a single morning prep workflow.

**Core Value:** Memory compounds daily. Every session, conversation, and capture adds to a growing knowledge base that makes tomorrow's work faster and more informed than today's.

### Constraints

- **Architecture**: Left/right split is a write-permission boundary, not a content-type split. Rule: "any file whose words should sound like ME lives on the LEFT"
- **Exclusions**: ISPN, Genesys, Asana content filtered at ingress — not post-hoc
- **Security**: Every integration operates at minimum viable permission
- **Voice**: LEFT side content must never be agent-written. Agent can read LEFT, propose to RIGHT
- **Platform**: Obsidian vault, Claude Code orchestration, Docker MCP gateway for external services
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Obsidian | 1.7+ | Vault substrate — markdown knowledge base | Already chosen. Local-first, plugin ecosystem, no vendor lock-in. Vault at `~/Claude Cowork/` |
| Claude Code | Current | Orchestration engine — runs commands, spawns agents, executes workflows | Already deployed. GSD framework provides phase management. `ccdScheduledTasksEnabled: true` confirmed in `claude_desktop_config.json` |
| Docker MCP Gateway | Current | MCP server routing for Claude Desktop | Already configured (`MCP_DOCKER` in claude_desktop_config.json). Single entry point for all Docker-hosted MCP servers |
| Obsidian Local REST API plugin | 3.x | HTTP bridge between Claude and vault | Verified integration path per PROJECT.md ("Docker MCP gateway > Local REST API plugin"). Exposes vault read/write over localhost |
| Node.js | 22 LTS | Script runtime for scheduling, connectors, utility scripts | Project code lives at `~/projects/second-brain/`. Node is the natural runtime for MCP server authoring and cron orchestration |
### MCP Server Ecosystem
| Server | Source | Purpose | Permission Model | Confidence |
|--------|--------|---------|------------------|------------|
| `obsidian-mcp` (via Docker) | `mcp/obsidian` Docker image | Read/write vault through Local REST API plugin | Read everywhere, write only RIGHT side | HIGH — already wired per PROJECT.md |
| `github-official` (via Docker) | Docker MCP gateway | GitHub activity for `/today` briefing, issue tracking | Read + issue-write on UsernameTron repos only | HIGH — OAuth done per PROJECT.md |
| `@modelcontextprotocol/server-filesystem` | npm (stdio) | Direct filesystem access to project directory | Read/write within `/Users/cpconnor/projects/` | HIGH — already configured in claude_desktop_config.json |
| Gmail MCP connector | See "Gmail Integration" below | VIP-filtered email for `/today`, draft creation | Draft-only, never send | MEDIUM — connector choice pending |
| Google Calendar MCP connector | See "Calendar Integration" below | Meeting schedule for `/today` briefing | Read-only | MEDIUM — connector choice pending |
### Gmail Integration
| Option | Approach | Tradeoffs | Recommendation |
|--------|----------|-----------|----------------|
| Docker MCP `google-drive` + Gmail scope | Official Docker MCP catalog server with Gmail API scopes | Best permission scoping; draft-only enforceable via OAuth scope `gmail.compose` (excludes `gmail.send`). Requires Google Cloud OAuth consent screen setup. | **Use this** |
| `@anthropic/mcp-gmail` (if available in Docker catalog) | Purpose-built Gmail MCP | Simpler if it exists in the Docker MCP catalog at implementation time. Check `docker mcp catalog` for availability. | Check first; fall back to custom |
| Custom Node.js MCP server | Hand-rolled using googleapis npm package | Full control over permission model. More code to maintain. | Fall back if Docker catalog lacks Gmail |
| Cowork native connector | Claude Desktop built-in | PROJECT.md lists as "preferred." Availability depends on Anthropic's connector roadmap. | Use if available at implementation time; do not block on it |
- `gmail.readonly` — read VIP-filtered messages for `/today`
- `gmail.compose` — create drafts only (excludes `gmail.send`)
- Never request `gmail.send` or `gmail.modify`
### Google Calendar Integration
| Option | Approach | Tradeoffs | Recommendation |
|--------|----------|-----------|----------------|
| Docker MCP `google-calendar` | Official or community Docker MCP image | Clean read-only scope via `calendar.events.readonly`. Consistent with Docker gateway pattern. | **Use this** |
| Custom Node.js MCP server | Hand-rolled using googleapis npm package | Same tradeoff as Gmail custom — full control, more maintenance. | Fall back if Docker catalog lacks Calendar |
| Cowork native connector | Claude Desktop built-in | Same as Gmail — preferred if available. | Use if available; do not block |
- `calendar.events.readonly` — read today's meetings
- Never request write scopes
### Scheduling and Cron
| Technology | Purpose | Why Recommended |
|------------|---------|-----------------|
| `ccdScheduledTasksEnabled` (Claude Desktop) | Scheduled `/today` execution | Already enabled in config. Native Claude Desktop scheduling — no external cron daemon needed |
| Claude Desktop Scheduled Tasks | Define recurring task that invokes `/today` command pre-morning | First-class integration. Task runs in Claude Desktop context with full MCP access |
| macOS `launchd` (fallback) | System-level scheduling if Claude Desktop scheduling is insufficient | Use only if Claude Desktop tasks lack cron-style recurrence or reliability. More complex, requires plist management |
- Raw `crontab` — inferior to launchd on macOS, no process lifecycle management
- Third-party schedulers (n8n, Temporal) — overengineered for single-user vault automation
- pm2 cron — adds Node process manager dependency for a single scheduled task
### Memory Compounding
| Component | Implementation | Purpose |
|-----------|---------------|---------|
| `memory.md` | RIGHT side of vault | Agent-maintained long-term memory. Compounding knowledge base updated after sessions |
| `memory-proposals.md` | RIGHT side of vault | Staging area for memory candidates. Human-in-the-loop approval before promotion |
| Memory extraction logic | Claude Code skill or `/wrap` hook | Auto-extract learnings, decisions, patterns from session transcripts |
| Memory promotion logic | `/new` command or dedicated skill | Move approved proposals from staging to `memory.md` with wikilink back-references |
## [Category]
### [Date] — [One-line summary]
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `googleapis` | 144+ | Google API client (Gmail, Calendar) | Only if building custom MCP servers (fallback path) |
| `@modelcontextprotocol/sdk` | 1.x | MCP server SDK for Node.js | Only if building custom MCP servers |
| `gray-matter` | 4.x | YAML frontmatter parsing for vault files | Parsing Obsidian note metadata in scripts |
| `date-fns` | 3.x | Date manipulation for `/today` scheduling logic | Timezone-aware date formatting in briefing scripts |
### Obsidian Plugin Requirements
| Plugin | Purpose | Required | Notes |
|--------|---------|----------|-------|
| Local REST API | MCP gateway bridge to vault | YES | Core integration path. Must be running for any agent vault access |
| Dataview | Structured queries across vault | RECOMMENDED | Enables dynamic note aggregation for `/today` data gathering |
| Templater | Template execution for new notes | RECOMMENDED | Powers `/new` routing — creates notes from templates in correct LEFT/RIGHT location |
| Calendar (Community) | Visual calendar in vault | OPTIONAL | Nice for daily note navigation but not required for `/today` |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| Docker Desktop | MCP gateway host | Already installed per config. Runs obsidian-mcp, github-official, and Google connectors |
| GSD Framework | Phase management, planning, execution | Already deployed at `~/.claude/get-shit-done/` |
| Claude Code hooks | Lifecycle automation (session start, stop, pre-commit) | Already configured per `.claude/settings.json` |
## Installation
# If building custom Google MCP servers (fallback path only):
# If parsing vault frontmatter in scripts:
# Docker MCP servers (no npm — pulled as Docker images):
# Configured in claude_desktop_config.json or .docker/mcp.json
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Docker MCP gateway for Google services | Direct stdio MCP servers | If Docker overhead is unacceptable for a lightweight vault. Unlikely given Docker already deployed. |
| Claude Desktop scheduled tasks | macOS launchd | If scheduled tasks need to run when Claude Desktop is closed. Launchd runs at OS level. |
| Obsidian Local REST API | Obsidian CLI / direct file writes | If REST API plugin becomes unreliable. Direct file writes lose Obsidian indexing/sync. |
| `memory-proposals.md` staging | Direct-write to `memory.md` | Never — violates human-in-the-loop constraint from PROJECT.md |
| Node.js for MCP servers | Python for MCP servers | If team prefers Python. MCP SDK exists for both. Node is more natural for this project given Claude Code ecosystem. |
| Single `memory.md` | Database-backed memory (ChromaDB, Mem0) | If memory exceeds ~500 entries and search becomes slow. Markdown-first is correct for <500 entries in a personal vault. |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| n8n / Temporal / Airflow | Overengineered for single-user vault automation. Adds infrastructure, monitoring, and failure modes that exceed the problem scope. | Claude Desktop scheduled tasks + Claude Code skills |
| ChromaDB / vector stores for memory | Premature optimization. Markdown search with grep/Dataview handles personal knowledge scale. Vector stores add embedding pipelines and infrastructure. | `memory.md` + Obsidian search + Dataview queries |
| Obsidian Git plugin for sync | Conflates vault versioning with project versioning. Vault and project have different lifecycles (per KEY DECISIONS in PROJECT.md). | Git only in `~/projects/second-brain/`. Vault syncs via Obsidian Sync or iCloud. |
| Gmail API `gmail.send` scope | Violates zero-trust posture. Once granted, any MCP server bug could send email as user. | `gmail.compose` (draft-only) + `gmail.readonly` |
| Custom scheduling daemons | Adds process management, logging, and failure recovery for a single daily task. | Built-in `ccdScheduledTasksEnabled` |
| Electron/web UI for memory review | Overbuilds the interface. Obsidian IS the UI. | Review `memory-proposals.md` directly in Obsidian |
| LangChain / LlamaIndex | Orchestration framework overhead for a system that already has Claude Code as its orchestrator. Adds abstraction layers without value. | Direct Claude Code skills and MCP tool composition |
## Architecture Pattern: MCP Gateway Topology
## Permission Enforcement Matrix
| Integration | Read Scope | Write Scope | Enforcement Point |
|-------------|------------|-------------|-------------------|
| Obsidian vault | All files | RIGHT side only | MCP server config (path allowlist) |
| Gmail | VIP-filtered inbox | Drafts only | OAuth scope (`gmail.compose`, not `gmail.send`) |
| Google Calendar | All events | None | OAuth scope (`calendar.events.readonly`) |
| GitHub | All UsernameTron repos | Issues only | OAuth scope + repo allowlist |
| Filesystem | `/Users/cpconnor/projects/` | Same | MCP server path config |
## Version Compatibility
| Component | Compatible With | Notes |
|-----------|-----------------|-------|
| Docker MCP Gateway | Docker Desktop 4.x+ | Requires Docker Desktop running. `docker mcp` CLI subcommand. |
| Obsidian Local REST API | Obsidian 1.4+ | API port defaults to 27123. Ensure no firewall blocks. |
| Claude Desktop scheduled tasks | `ccdScheduledTasksEnabled: true` | Feature flag already enabled. Recurrence configuration TBD at implementation. |
| `@modelcontextprotocol/sdk` 1.x | Node.js 18+ | LTS Node recommended for MCP server stability |
## Open Questions (flag for phase research)
## Sources
### Primary (HIGH confidence)
- `/Users/cpconnor/projects/second-brain/.planning/PROJECT.md` — project requirements, constraints, key decisions, integration status
- `/Users/cpconnor/Library/Application Support/Claude/claude_desktop_config.json` — verified MCP_DOCKER gateway, skills-filesystem, ccdScheduledTasksEnabled
- `/Users/cpconnor/.claude/settings.json` — verified Claude Code hooks, plugin ecosystem, permission model
### Secondary (MEDIUM confidence)
- MCP ecosystem knowledge from training data (pre-May 2025) — Docker MCP gateway pattern, `@modelcontextprotocol/sdk`, Google API scoping
- Obsidian Local REST API plugin knowledge from training data — API surface, port defaults
### Tertiary (LOW confidence)
- Gmail/Calendar MCP server availability in Docker catalog — needs runtime verification
- Claude Desktop scheduled task configuration syntax — needs documentation check
- Cowork native connector availability — depends on Anthropic's product roadmap
- Specific npm package versions — stated versions are training-data estimates, verify with `npm view [package] version` before installing
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.

## Session Handoffs

When the user says "stop," "kill the session," "we're done," or hands off to a future session via a carry-forward note: stop. Do not start any work mentioned in the carry-forward note. Carry-forward items belong to the next session, not the current one. Items described as "needs refresh," "should update," "to verify," or any other forward-looking phrasing in a handoff are reference material for the next session — not a task list for this one.

If you notice something that needs doing while writing a handoff, either do it before writing the handoff or leave it for the next session. Never both.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
