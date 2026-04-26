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

## Project Status

**Latest Release:** v1.5.0 Internal Hardening (2026-04-26)
**Phase 22 complete:** NFKD Unicode Matcher (2026-04-26)
**Phase 23 complete:** Pre-Commit Hooks (2026-04-26)
**Phase 24 complete:** Doc Sync Agent (2026-04-26)
**Phase 25 complete:** UAT Rebaseline (2026-04-26)

- **Test count:** 1190 total across 56 test files (1152 passing, 38 skipped)
- **Coverage:** Branch 81.28%, Statements 94.62%, Functions 96.94%, Lines 95.53%
- **Lint:** 0 ESLint no-console warnings
- **CI gates:** ESLint 10 flat config, CodeQL SAST, license-checker, Node 20+22 matrix, coverage ≥80%, GitGuardian secrets scan
- **Milestones shipped:** v1.0 MVP (2026-04-22), v1.1 Go Live (2026-04-23), v1.2 Automation & Quality (2026-04-23), v1.3 Review Remediation (2026-04-24), v1.4 Closeout Hygiene (2026-04-25), v1.5 Internal Hardening (2026-04-26)

For detailed release history, see [.planning/MILESTONES.md](.planning/MILESTONES.md).

## Commands

| Command | Purpose |
|---------|---------|
| `/today` | Daily prep list — 6-section briefing with slippage scan, frog identification, memory compounding |
| `/new` | Route mixed input to correct location via two-stage LLM classifier |
| `/wrap` | Session wrap with automatic memory extraction and proposal staging to `memory-proposals.md` |
| `/promote-memories` | Human-in-the-loop memory promotion from staging to `memory.md` |
| `/reroute` | Re-route previously classified item to different vault location |
| `/promote-unrouted` | Bulk-promote unrouted items from staging |
| `/recall <query>` | Keyword search over `memory.md` via minisearch — AND semantics, quoted phrases, negation. Flags: `--category <name>`, `--since YYYY-MM-DD`, `--top N` (default 5) |
| `/recall --semantic <query>` | Semantic search via Voyage AI embeddings with cosine similarity + recency decay (0.55 threshold). Same `--category` / `--since` / `--top N` flags apply |
| `/recall --hybrid <query>` | RRF fusion of keyword + semantic results; falls back to keyword if Voyage unavailable. Same `--category` / `--since` / `--top N` flags apply |

## Tech Stack

- **Vault:** Obsidian 1.7+ (local-first markdown, LOCAL REST API plugin required)
- **Orchestration:** Claude Code (GSD framework for phases, planning, execution)
- **Runtime:** Node.js 20+22 LTS (tested matrix in CI)
- **Integrations:** Gmail/Calendar/GitHub via MCP (Docker MCP Gateway + Obsidian Local REST API)
- **AI models:** Anthropic Haiku/Sonnet, LM Studio for local fallback
- **Testing:** Jest 30 (unit + integration), UAT tests guarded from CI via skip logic
- **Quality gates:** ESLint 10, CodeQL SAST, AJV schema validation, coverage ≥80%

**Key dependencies:** @anthropic-ai/sdk 0.90+, chokidar 3.6 (CJS compat), gray-matter 4.0, dotenv 17.4, AJV 8.18, voyageai 0.2.1 (Phase 19 semantic embeddings, exact pin, MIT)

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

## Architecture & Infrastructure

The system is deployed across five integration points:

1. **Vault substrate:** Obsidian (local-first markdown at `~/Claude Cowork/`) with Local REST API plugin as HTTP bridge
2. **Orchestration:** Claude Code via `/today`, `/new`, `/wrap` commands; GSD framework manages phases
3. **External integrations:** Gmail, Google Calendar, GitHub via MCP (Docker MCP Gateway running in Claude Desktop)
4. **AI models:** Anthropic Haiku (default) and Sonnet (heavier tasks), with LM Studio as local fallback
5. **Scheduling:** Claude Desktop scheduled tasks with `ccdScheduledTasksEnabled: true`

**Permission model:** LEFT vault side is read-only (human voice preserved); RIGHT side has full agent write access. OAuth scopes follow zero-trust: Gmail `gmail.compose` (draft-only, no send), Calendar read-only, GitHub issues-only.

**Key files in `src/`:**
- `vault-gateway.js` — vault boundary enforcement, LEFT/RIGHT write permission checks
- `today-command.js` — orchestrator that chains slippage-scanner, frog-identifier, llm-augmentation, briefing-renderer
- `classifier.js` — two-stage LLM classifier for `/new` command domain routing
- `memory-pipeline.js` — session extraction, proposal staging, human-in-the-loop promotion
- `semantic-index.js` — Phase 19 core: Voyage AI embeddings, cosine search, RRF hybrid fusion, embed-on-promotion
- `utils/voyage-health.js` — Phase 19 Pattern 7 adaptive denial tracker; persists degraded-mode state to `~/.cache/second-brain/voyage-health.json`
- Config loaders (`loadConfigWithOverlay`, schema validation via AJV)
- Hook infrastructure (auto-test, protected-file-guard, security-scan-gate, memory-extraction)

**Deployed agents (`.claude/agents/`):**
- `docs-sync.md` — documentation consistency checks
- `pipeline-reviewer.md` — CI/CD validation
- `security-scanner.md` — SAST and permission audits
- `test-runner.md` — test execution and failure diagnosis
- `test-verifier.md` — UAT validation
- `vault-guardian.md` — vault permission enforcement

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

**Naming:** CamelCase for commands (`/today`, `/new`, `/wrap`), camelCase for functions, UPPER_CASE for constants.

**Module structure:** Single-responsibility modules in `src/` with test counterparts in `test/` (mirror directory structure). Config files in `config/` with optional `.local.json` overlays and schema definitions.

**Code standards:** No `console.log` statements in production code (flagged by ESLint). All errors explicitly handled. Config loading always validates against AJV schema. Vault writes always check LEFT/RIGHT boundaries via `vault-gateway.js`.

**Testing:** Unit tests for individual functions, integration tests for cross-module flows (classifier → vault writes), UAT tests for end-to-end command behavior. UAT tests use skip logic (`process.env.CI && test.skip`) to exclude from CI env.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:PROJECT.md -->
## Architecture

See detailed architecture in [.planning/PROJECT.md](.planning/PROJECT.md) and release history in [.planning/MILESTONES.md](.planning/MILESTONES.md).

**High-level:** Two-stage LLM classifier routes user input to LEFT (identity/reference) or RIGHT (active work) vault locations. Daily `/today` command aggregates slippage items, calendar events, Gmail subjects, and GitHub activity into a morning briefing. Session `/wrap` extracts memories for compounding knowledge base. All writes enforce LEFT/RIGHT permission boundary.
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
