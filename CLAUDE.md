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
- **New files land in a folder, never the vault root.** Anything a Cowork or Claude Code session produces with no obvious home goes to `inbox/` for triage; standups go to `standups/`; per-project working notes go to `projects/<project>/`. The root holds `CLAUDE.md` and nothing else — it rotted into an 83-file junk drawer once (restructured 2026-07-26) and the daily-stats `vault_hygiene` count exists to catch the next drift within a day.

## Project Status

> Last verified: 2026-07-21  <!-- refresh at each /gsd:sync-docs; read by the SessionStart staleness hook (.claude/hooks/staleness-check.js, v1.6 REQ-CTX-01) -->

**Latest Release:** v1.7 Prove Compounding (2026-07-16)
**v1.8 Measured Memory (in progress):** Phases 32-35 shipped — Phase 32 Retrieval Eval Baseline 2026-07-19 (PR #74: `npm run eval:recall`, golden set, frozen seed vault, first baseline); Phase 33 Capture Reliability, Phase 34 Promotion Integrity + Dream Consolidation, and Phase 35 Proactive-Memory SessionStart Injection all 2026-07-21 (PRs #88/#86/#89). Phase 36 (Ingest Breadth) decision-gated, unscheduled.
**v1.7 complete (2026-07-16):** Series Integrity (Phase 29), Outcome Instrumentation (Phase 30), Trend & Report (Phase 31)
**v1.6 complete (2026-07-15):** Promotion Safety, Cross-Surface Reach (ADR-018/019), Context Honesty (staleness hook, ADR-020 authority hierarchy, fail-closed exclusions), Surface Completion (/reroute, pre-push docs gate)

- **Test count:** 1549 total across 82 test files (1511 passing, 38 skipped in CI)
- **Coverage:** Branch 81.15%, Statements 92.74%, Functions 96.02%, Lines 93.37% (CI-measured)
- **Lint:** 0 ESLint no-console warnings
- **CI gates:** ESLint 10 flat config, CodeQL SAST, license-checker, Node 22 matrix, coverage thresholds (branches 80 / functions 90 / lines 90 / statements 90), GitGuardian secrets scan

For detailed release history, see [.planning/MILESTONES.md](.planning/MILESTONES.md).

## Commands

| Command | Purpose |
|---------|---------|
| `/today` | Daily prep list — 6-section briefing with slippage scan, frog identification, memory compounding |
| `/new` | Route mixed input to correct location via two-stage LLM classifier |
| `/wrap` | Session wrap with automatic memory extraction and proposal staging to `memory-proposals.md`. Bare invocation extracts from this project's newest Claude Code transcript; `--transcript/--file/--dir/--since` override. **Exits non-zero when extraction hard-fails** (Haiku error, malformed JSON, unreadable transcript) — a failed extraction is distinguishable from an empty one. CLI: `node scripts/wrap.js` |
| `/promote-memories` | Human-in-the-loop memory promotion from staging to `memory.md` |
| `/reroute` | Re-route previously classified item to different vault location |
| `/promote-unrouted` | Re-route a single unrouted dead-letter file to a target vault path |
| `/recall <query>` | Keyword search over `memory.md` via minisearch — AND semantics, quoted phrases, negation. Flags: `--category <name>`, `--since YYYY-MM-DD`, `--top N` (default 5) |
| `/recall --semantic <query>` | Semantic search via Voyage AI embeddings with cosine similarity + recency decay (0.55 threshold). Same `--category` / `--since` / `--top N` flags apply |
| `/recall --hybrid <query>` | RRF fusion of keyword + semantic results; falls back to keyword if Voyage unavailable. Same `--category` / `--since` / `--top N` flags apply |
| `node scripts/recall.js "<query>"` | Standalone recall CLI — same flags as `/recall`, runnable from any directory/session on this machine (v1.6 reach layer, ADR-019) |
| `/today` (with `## Compounding` section) | Daily briefing includes compounding evidence when available: last 7 entries added/modified, cumulative promotion count, memory growth trend (v1.7 Phase 30) |
| `node scripts/compounding-report.js` | Standalone compounding evidence report CLI — summarizes memory growth metrics, promotion velocity, and verdict (v1.7 Phase 31) |
| `npm run eval:recall` | Retrieval eval over the frozen seed vault (`eval/seed-vault/`) + golden set (`eval/golden-recall.json`) — recall@5 + MRR across keyword/semantic/hybrid, compared against `eval/baseline-*.json`. `-- --baseline` re-anchors. Exit 1 on regression (v1.8 Phase 32) |
| `npm run dream:propose` | Monthly dream-consolidation propose pass over `memory.md` — stages MERGE/STALE ops into `proposals/dream-changeset-YYYY-MM.md` + missed patterns into the normal proposals gate; applies nothing (v1.8 Phase 34). Also scheduled via `com.secondbrain.dream` launchd plist (1st of month, 07:15, Anthropic-pinned) |
| `npm run dream:apply` | Human-invoked-only apply of the accepted dream changeset — snapshot-first, then an `eval:recall` retrievability gate with auto-restore on regression (v1.8 Phase 34) |
| `npm run verify:baseline` | Verifies the 27 pre-governance memory-entry hashes; real exit code, wired into the pre-push gate (v1.8 Phase 34, VERIFY-SENTINEL-01) |

**Reach layer (v1.6, SURFACE-REACH-01):** every real promotion regenerates a pointer + digest cache (`second-brain.md` + `MEMORY.md` index line) in the auto-memory dirs allowlisted in `config/reach-targets.json`, via `src/reach-exporter.js`. Digest entries re-pass the content-policy exclusion gate at egress, fail-closed. See `decisions/ADR-019-reach-layer-mechanism.md`.

> **Source-of-truth hierarchy:** `ABOUT ME/` canon > `memory.md` > this file > auto-memory blob. This file is a router, not a fact store — see [decisions/ADR-020-authority-hierarchy.md](decisions/ADR-020-authority-hierarchy.md).

## Development

```bash
npm test                                  # full Jest suite (verbose)
npx jest test/promote-memories.test.js    # single file
npx jest -t "promotes accepted candidates" # single test by name
npm run lint                              # ESLint 10 flat config over src/ test/
npm run test:uat                          # UAT suite (CI= unsets CI so skip-logic runs them)
npm run test:integration:voyage           # live Voyage embeddings; no-ops without VOYAGE_API_KEY
npm run license-check                     # production dep license allowlist
```

There is no build step — plain CJS Node, run directly.

**Git hooks are repo-managed** (`npm run prepare` sets `core.hooksPath=hooks`, so `hooks/` is live, not `.git/hooks/`):
- `pre-commit` — AJV schema validation of `config/*.json` + vault LEFT/RIGHT boundary check
- `pre-push` — blocks branches based on a stale local master, then runs the docs-sync gate (`SKIP_DOCSYNC=1` bypasses only the docs half)
- `post-merge` — docs drift warning, non-blocking by design (never exits non-zero)

Claude Code hooks live separately in `.claude/hooks/` (auto-test, protected-file-guard, security-scan-gate, memory-extraction, staleness-check, session-memory-inject).

## Tech Stack

- **Vault:** Obsidian 1.7+ (local-first markdown, LOCAL REST API plugin required)
- **Orchestration:** Claude Code (GSD framework for phases, planning, execution)
- **Runtime:** Node.js 22 LTS or newer — required by `node:sqlite` (tested in CI)
- **Integrations:** GitHub + Obsidian via Docker MCP Gateway (mcp__MCP_DOCKER__*); Gmail + Calendar via claude.ai connectors (mcp__claude_ai_*). Session/Desktop-connected — only context7 is registered in repo .mcp.json.
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
3. **External integrations:** GitHub + Obsidian via the Docker MCP Gateway (Claude Desktop); Gmail + Calendar via claude.ai connectors. None are registered in repo .mcp.json (context7 only).
4. **AI models:** Anthropic Haiku (default) and Sonnet (heavier tasks), with LM Studio as local fallback
5. **Scheduling:** macOS launchd — `com.secondbrain.today` (weekdays 06:45), `com.secondbrain.daily-sweep` (23:45), `com.secondbrain.dream` (1st of month 07:15); plists versioned in `config/`. RemoteTrigger is vault-unreachable and disabled by design (`config/scheduling.json`)

**Permission model:** LEFT vault side is read-only (human voice preserved); RIGHT side has full agent write access. OAuth scopes follow zero-trust: Gmail `gmail.compose` (draft-only, no send), Calendar read-only, GitHub issues-only.

**Key files in `src/`:**
- `vault-gateway.js` — vault boundary enforcement, LEFT/RIGHT write permission checks
- `today-command.js` — orchestrator that chains slippage-scanner, frog-identifier, llm-augmentation, briefing-renderer
- `classifier.js` — two-stage LLM classifier for `/new` command domain routing
- `memory-extractor.js` / `memory-proposals.js` / `promote-memories.js` — the memory pipeline: session extraction → proposal staging → human-in-the-loop promotion
- `semantic-index.js` — Phase 19 core: Voyage AI embeddings, cosine search, RRF hybrid fusion, embed-on-promotion
- `utils/voyage-health.js` / `utils/classifier-health.js` — Pattern 7 adaptive denial trackers; persist degraded-mode state to `~/.cache/second-brain/*.json`
- Config loaders (`loadConfigWithOverlay`, schema validation via AJV)
- Hook infrastructure (auto-test, protected-file-guard, security-scan-gate, memory-extraction)

**Deployed agents (`.claude/agents/`):**
- `docs-sync.md` — documentation consistency checks
- `memory-specialist.md` — memory pipeline diagnostics
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

See detailed architecture in [.planning/PROJECT.md](.planning/PROJECT.md); the "Architecture & Infrastructure" section above is the inline reference.
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
