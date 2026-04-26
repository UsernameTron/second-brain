# Second Brain

## What This Is

An Obsidian vault orchestrated into a personal operating system with compounding memory, proactive daily briefing, intelligent input routing, and external integrations. Code at ~/projects/second-brain/, vault at ~/Claude Cowork/, coupled through Obsidian MCP. Left/right write-permission architecture preserves human voice on LEFT while agent-generated content writes to RIGHT. Integrates Gmail (draft-only), Google Calendar (read-only), GitHub (UsernameTron-scoped), and cross-project GSD state into a single `/today` morning prep workflow.

## Current State

**v1.4 shipped 2026-04-26 (tag v1.4).** Five milestones complete: v1.0 MVP (2026-04-22), v1.1 Go Live (2026-04-23), v1.2 Automation & Quality (2026-04-23, tag v1.2.0), v1.3 Review Remediation (2026-04-24, tag v1.3.0), v1.4 Memory Activation & Final Closeout (2026-04-26, tag v1.4). Memory layer is now bidirectional — write path operating since v1.0, read path activated in v1.4 via `/recall` (keyword + semantic + RRF hybrid) and Memory Echo in `/today`.

**Stats post-v1.4:** 1127 tests across 55 files (1044 passing, 38 skipped, 45 todo). Coverage 81.28% branch / 94.62% statements / 96.94% functions / 95.53% lines. 9,617 LOC in `src/`. 0 ESLint no-console warnings (35 category-tagged disables). JSDoc on 53 public exports.

**What works end-to-end:**
- `/new` classifies input, enforces left/right routing, filters excluded content (15 terms with substring matching), suggests wikilinks
- `/today` produces 6-section daily briefing with Memory Echo, yesterday-summary line, and graceful degradation
- `/recall <query>` keyword search with `--category`, `--since`, `--top N` flags
- `/recall --semantic <query>` Voyage AI cosine search (calibrated 0.55 threshold, post-UAT)
- `/recall --hybrid <query>` RRF fusion of keyword + semantic
- `/promote-memories` writes to `memory.md` AND embeds new entries to `~/.cache/second-brain/embeddings.jsonl`
- `/today` records per-day stats row in `RIGHT/daily-stats.md` (8 columns: date/proposals/promotions/total_entries/memory_kb/recall_count/avg_latency_ms/avg_confidence)
- Voyage degradation: 3-failure threshold → 15-min cross-invocation window persisted to `voyage-health.json`; falls back to keyword with banner
- Gmail (OAuth, draft-only), Calendar (read-only), GitHub (UsernameTron-scoped) connectors with per-connector latency captured
- RemoteTrigger active for weekday pre-morning `/today` execution
- GitHub Actions CI: Node 20+22 matrix, ESLint, CodeQL SAST, license-checker, coverage ≥80%, GitGuardian secrets scan
- UAT workflow: weekly cron + manual `workflow_dispatch`, ANTHROPIC_API_KEY scoped step-only, 90-day artifact retention
- Branch protection on master: PR-required-reviews, required CI checks (test (20)/test (22)/Analyze), force-push blocked

**Known gaps (carried to v1.5 backlog in `tasks/todo.md`):**
- HYG-UNICODE-02 — Unicode-variant matcher upgrade (45 test.todo entries staged)
- HOOK-VAULT-01 / HOOK-SCHEMA-01 / HOOK-DOCSYNC-01 — Committed pre-commit/post-merge hooks
- AGENT-DOCSYNC-01 / AGENT-VERIFY-01 / AGENT-MEMORY-01 — New agent surface
- UAT-CORPUS-REFRESH-01 — Rebaseline classification corpus after excluded-terms expansion
- DOTENV-FIX-01 — Suite-level dotenv neutralization (precedent in PR #38)
- Phase 17 UAT workflow smoke run still deferred per Pete's checkpoint
- FIX-02 (config hot-reload) — restart workaround sufficient

## Current Milestone: v1.5 Internal Hardening

**Goal:** Harden the development infrastructure — committed hooks, new agent surface, test corpus rebaseline, and Unicode-safe matching — closing every deferred backlog item from v1.4.

**Target features:**
- Pre-commit AJV schema validation on config/frontmatter (HOOK-SCHEMA-01)
- Pre-commit LEFT/RIGHT boundary enforcement at git layer (HOOK-VAULT-01)
- Post-merge documentation drift detection hook (HOOK-DOCSYNC-01)
- Entry-point-only dotenv loading (HOOK-DOTENV-01)
- Post-ship documentation drift detection agent (AGENT-DOCSYNC-01)
- Requirement-level auto-verification via subagent fan-out (AGENT-VERIFY-01)
- Memory health monitor surfacing anomalies in /today (AGENT-MEMORY-01)
- Rebaseline UAT classification corpus (UAT-CORPUS-REFRESH-01)
- Unicode-variant matcher upgrade for excluded terms (HYG-UNICODE-02)
- UAT workflow smoke run (Phase 17 carry-forward)

## Core Value

Memory compounds daily. Every session, conversation, and capture adds to a growing knowledge base that makes tomorrow's work faster and more informed than today's.

## Requirements

### Validated

- ✓ Left/right vault directory structure with write-permission enforcement — v1.0
- ✓ `/new` ingress filtering: ISPN, Genesys, Asana content stripped before writing to disk — v1.0
- ✓ Wikilink cross-references between left and right sides — v1.0
- ✓ `/new` command: multi-domain input router classifying by domain and left/right write permission — v1.0
- ✓ `/new` routing rules: voice/reflections/drafts → LEFT, agent-derived/summaries → RIGHT — v1.0
- ✓ `memory-proposals.md` extraction pipeline with source attribution — v1.0
- ✓ `memory.md` promotion workflow with human review gate — v1.0
- ✓ Proposal batches capped at 5-10 items — v1.0
- ✓ Gmail MCP connector (draft-only permission, no send) with VIP filtering — v1.0
- ✓ Google Calendar MCP connector (read-only permission) — v1.0
- ✓ GitHub activity connector (UsernameTron repo scoping) — v1.0
- ✓ `/today` command: 6-section morning prep list — v1.0
- ✓ `/today` data-source health reporting — v1.0
- ✓ `/today` cross-project slippage detection — v1.0
- ✓ `/today` frog identification — v1.0
- ✓ Scheduled `/today` execution via RemoteTrigger — v1.0
- ✓ Graceful degradation when MCP sources fail — v1.0
- ✓ Anti-AI writing style enforcement in vault content — v1.0
- ✓ Centralized write-gateway function — v1.0
- ✓ Dead-letter lifecycle with auto-retry — v1.0
- ✓ Wikilink suggestion engine — v1.0

- ✓ Gmail OAuth wired (real credentials, live VIP filtering) — v1.1
- ✓ RemoteTrigger enabled on real cron schedule — v1.1
- ✓ Excluded terms expanded to production list (15 terms, substring matching) — v1.1
- ✓ In-batch dedup bug fixed in promote-memories (3 sub-bugs) — v1.1
- ✓ Remote execution hardened (calendar MCP, path resolution, Haiku graceful degradation) — v1.1
- ✓ UAT pass (LLM accuracy, wikilink relevance, promotion dedup) — v1.1
- ✓ CI pipeline (GitHub Actions, Node 20+22, push + PR triggers) — v1.1

- ✓ Auto-run tests on source edit (PostToolUse observer hook) — v1.2
- ✓ Protected file edit guard (PreToolUse gate for .env, config/schema, credentials) — v1.2
- ✓ Security scan gate integration contract (stub for Phase 9) — v1.2
- ✓ Security scanner agent (read-only, secrets + npm audit + protected files) — v1.2
- ✓ Independent test verification gate (read-only reporter, haiku model) — v1.2
- ✓ Config/schema validation skill (AJV-based, dynamic discovery) — v1.2
- ✓ Agent roster hardened (trigger language, output contracts for 4 agents) — v1.2
- ✓ Pipeline health check skill (6-check diagnostic) — v1.2
- ✓ context7 MCP integration (library docs via .mcp.json) — v1.2
- ✓ CI coverage enforcement (90% stmts/funcs/lines, npm audit gating) — v1.2
- ✓ Local LLM routing (configurable provider, Anthropic fallback with logging) — v1.2

- ✓ Scheduled UAT workflow with secret isolation (weekly cron + workflow_dispatch, ANTHROPIC_API_KEY scoped to step only) — v1.4 Phase 17
- ✓ UAT accuracy report artifact retained 90 days — v1.4 Phase 17
- ✓ Branch protection on master: PR required, force-push blocked, required checks test (20)/test (22)/Analyze — v1.4 Phase 17

- ✓ UAT CI scheduled workflow with secret isolation + 90-day artifact retention — v1.4 Phase 17
- ✓ Branch protection on master (PR-required-reviews, force-push blocked, required CI checks) — v1.4 Phase 17
- ✓ Memory Retrieval Foundation (readMemory, /recall keyword mode with --category/--since/--top N flags, Memory Echo in /today at 0.65 threshold) — v1.4 Phase 18
- ✓ Semantic Memory Search (Voyage AI `voyage-4-lite` embeddings on promotion, cosine + temporal decay at 0.55 threshold, RRF hybrid, Pattern 7 degradation 3-failure/15-min window) — v1.4 Phase 19
- ✓ Value Extraction Instrumentation (per-day daily-stats.md row with 8 columns, idempotent same-day update, per-connector + per-operation latency capture, yesterday-summary line at top of /today) — v1.4 Phase 20
- ✓ Closeout Hygiene (HYG-UNICODE-01 Path B with 45 test.todo markers, HYG-JSDOC-01 on 53 public exports, HYG-CONSOLE-01 with 35 category-tagged disables, DOCS-FINAL-01 across 8 living docs) — v1.4 Phase 21

### Active

(Defined in REQUIREMENTS.md — see v1.5 Internal Hardening scope.)

<details>
<summary>v1.4 Memory Activation & Final Closeout (shipped 2026-04-26, tag v1.4)</summary>

**Goal:** Activate the write-only memory layer (keyword + semantic retrieval), prove memory compounds daily via instrumentation, close the UAT CI gap, and clear every low-priority hygiene item. No changes to existing working behavior — all additions. The closing milestone of the v1.x cycle.

**Delivered:** 5 phases (17–21), 23 plans. UAT CI on weekly cron with branch protection on master. Memory retrieval (keyword via minisearch, semantic via Voyage AI, RRF hybrid). Pattern 7 graceful degradation with cross-invocation persistence. Daily stats instrumentation with yesterday-summary line. Closeout hygiene: 0 ESLint no-console warnings, JSDoc on all 53 public exports, all 8 living docs synced. Audit completed (status: tech_debt — Option C selected, user-facing flag-doc gap closed in PR #48, process drift documented).

**Stats:** 1127 tests across 55 files (1044 passing, 38 skipped, 45 todo). 81.28% branch / 94.62% statements / 96.94% functions / 95.53% lines coverage. PRs #25–#48.

**Deferred to v1.5:** HYG-UNICODE-02 Unicode matcher, HOOK-VAULT-01/HOOK-SCHEMA-01/HOOK-DOCSYNC-01 committed hooks, AGENT-DOCSYNC-01/AGENT-VERIFY-01/AGENT-MEMORY-01 agent surface, UAT-CORPUS-REFRESH-01 classifier corpus rebaseline, DOTENV-FIX-01 suite-level neutralization. Phase 17 UAT smoke run still deferred per Pete's 17-03 checkpoint.

**Key locked decisions:** Voyage `voyage-4-lite` model + 0.55 threshold (calibrated empirically); `schema_version = hash(model || dim)` only; America/Chicago timezone for daily-stats; ASCII-only excluded-term matching for v1.4 (Unicode deferred); `/new` behavior untouched.
</details>

<details>
<summary>v1.3 Review Remediation (shipped 2026-04-24)</summary>

**Goal:** Close every HIGH finding from the 3-reviewer audit and every WARN from v1.2 milestone audit. Health score 76/100 → ≥88.

**Delivered:** 5 phases (12–16). Critical safety fixes (vault-gateway bypass, config crash paths, hook repair). Config schema gaps closed. CI hardening (ESLint, CodeQL SAST, license-checker). Architecture refactor (today-command decomposed 727→230 LOC). Test quality lift (+114 tests, branch coverage 75%→81%, threshold ratcheted 70%→80%). 15/18 backlog items closed.

**Deferred to v1.4:** B-15, B-18, B-20, B-21, branch protection.
</details>

<details>
<summary>v1.2 Automation & Quality (shipped 2026-04-23)</summary>

**Goal:** Close quality, security, and automation gaps. No new features — hardening the development workflow and CI pipeline.

**Delivered:** 4 phases (8–11). Hook infrastructure (auto-test, protected-file-guard, security-scan-gate). Security & verification agents. Agent roster hardened. Pipeline health skill. context7 MCP integration. CI coverage enforcement (90% stmts/funcs/lines). Local LLM routing.
</details>

<details>
<summary>v1.1 Go Live (shipped 2026-04-23)</summary>

**Goal:** Close the gap between "works in tests" and "works on my desk at 6:45 AM."

**Delivered:** Gmail OAuth wired. RemoteTrigger on weekday cron. Excluded terms expanded to 15 with substring matching. In-batch dedup fixed. Remote execution hardened. UAT pass. GitHub Actions CI pipeline (Node 20+22).

**Deferred:** FIX-02 (config hot-reload) — restart workaround sufficient.
</details>

### Out of Scope

- ISPN content — hard exclusion from all memory promotion and ingress
- Genesys content — hard exclusion from all memory promotion and ingress
- Asana content — hard exclusion from all memory promotion and ingress
- Gmail send capability — zero-trust: draft-only
- Calendar write capability — zero-trust: read-only
- Mobile app — vault accessed via Obsidian desktop/sync
- Real-time sync — batch processing (cron + on-demand) is sufficient
- Autonomous email sending — one hallucination away from a career incident
- Chat interface for vault — Claude Code sessions ARE the chat interface
- Automatic memory promotion — skipping human review gate amplifies errors
- Complex taxonomy/tagging — left/right split + wikilinks is sufficient
- Notification system — pull-based (/today) only; push creates anxiety

## Context

**Vault substrate (already exists):**
- `ABOUT ME/about-me.md` — identity, work style, communication preferences
- `ABOUT ME/anti-ai-writing-style.md` — banned words/patterns, tone calibration
- `ABOUT ME/my-company.md` — Connor Advisors, CTG engagement, active projects, career strategy

**Integrations already wired:**
- Obsidian — Docker MCP gateway → Local REST API plugin (verified)
- GitHub — Docker MCP gateway → github-official (OAuth done)
- Filesystem — Claude Code direct read/write on `/Users/cpconnor/projects/`
- Claude in Chrome — paired browsing agent (not a /today source)

**Integrations built (Phase 3):**
- Gmail — src/connectors/gmail.js wrapping gmail-mcp-pete MCP server, VIP filtering, draft-only
- Google Calendar — src/connectors/calendar.js wrapping Cowork native MCP tools, working-hours filtering, read-only
- GitHub — src/connectors/github.js wrapping Docker MCP tools, UsernameTron repo scoping, Promise.allSettled

**Runtime:**
- `ccdScheduledTasksEnabled = true` in claude_desktop_config.json for cron-based /today

**Inspiration:**
- Cole Medin — memory compounding patterns, daily knowledge extraction
- Eric Michaud — structured vault architecture, proactive briefing systems

**Zero-trust posture (all integrations):**
- Gmail: draft only, never send
- Calendar: read only
- GitHub: read + issue-write on UsernameTron repos only
- Obsidian: read everywhere, write only to RIGHT side of vault
- Filesystem: read + write within `/Users/cpconnor/projects/` only

## Constraints

- **Architecture**: Left/right split is a write-permission boundary, not a content-type split. Rule: "any file whose words should sound like ME lives on the LEFT"
- **Exclusions**: ISPN, Genesys, Asana content filtered at ingress — not post-hoc
- **Security**: Every integration operates at minimum viable permission
- **Voice**: LEFT side content must never be agent-written. Agent can read LEFT, propose to RIGHT
- **Platform**: Obsidian vault, Claude Code orchestration, Docker MCP gateway for external services

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Write-permission split (not content-type) | Voice preservation is the governing principle — keeps human authenticity intact. Left = human-only writes; right = agent-writable. | ✓ Good — enforced at /new ingress and write-gateway |
| Project-alongside-vault | Separation of concerns: code changes weekly, vault changes daily; different lifecycles. | ✓ Good — project at ~/projects/second-brain/, vault at ~/Claude Cowork/ |
| Ingress filtering over post-hoc removal | Cheaper to strip excluded content at /new than chase it across files after the fact | ✓ Good — three-gate pipeline catches at capture |
| memory-proposals.md staging area | Human-in-the-loop prevents agent hallucinations from entering long-term memory | ✓ Good — promotion requires explicit /promote-memories |
| Cowork native for Calendar, custom MCP for Gmail | Calendar: Cowork MCP simpler. Gmail: needed custom server for VIP filtering and draft-only enforcement. | ✓ Good — both connectors working with zero-trust scopes |
| chokidar v3 (not v5) | v5 is ESM-only, project uses CJS | ✓ Good — avoided breaking change |
| LLM classify() never throws | Returns {success, data/error, failureMode} — callers handle gracefully | ✓ Good — enables graceful degradation in /today |
| Wikilink enrichment non-blocking | Failures logged, never block pipeline | ✓ Good — /new completes even if wikilinks fail |
| Dead-letter auto-retry: 15-min, 3-attempt cap, freeze | Prevents infinite retry loops while giving transient failures a chance | ✓ Good — bounded retry with freeze semantics |
| RemoteTrigger for scheduling (not launchd) | First-class Claude integration, no plist management | ✓ Good — activated v1.1, fires weekday mornings |
| PR time-window filtering client-side | list_pull_requests lacks since param | ✓ Good — filter by updated_at after fetch |
| Partial GitHub MCP failure returns warnings[] | Preserves partial data for /today degraded mode | ✓ Good — matches graceful degradation design |
| Substring matching for excluded terms | Word-boundary regex missed embedded substrings | ✓ Good — single toLowerCase, catches all variants |
| AUTH_ERRORS structural comparison | errorType field not string matching — resilient to message changes | ✓ Good — typed error taxonomy |
| UAT harnesses call real Anthropic API | Accuracy and relevance cannot be validated with stubs | ✓ Good — verified LLM quality in CI-excluded tests |
| GitHub Actions Node 20+22 matrix | LTS coverage without maintaining older versions | ✓ Good — CI green on both |
| Branch protection: PR-required-reviews on master (v1.4) | Classic `required_status_checks` only gates PR merges, NOT direct pushes; without `required_pull_request_reviews` (non-null) direct push with red CI lands. Required for solo-dev safety. | ✓ Good — direct pushes blocked since 2026-04-24 |
| ANTHROPIC_API_KEY scoped step-only in uat.yml (v1.4) | Workflow-level or job-level secrets leak to all steps; step-level scoping is P11 prevention | ✓ Good — verified by grep across ci.yml, codeql.yml, uat.yml |
| Voyage AI `voyage-4-lite` for semantic embeddings (v1.4) | Cloud posture matches Anthropic; generous free tier; SDK quality; cosine + temporal decay computable client-side | ✓ Good — embed-on-promotion working, 0.55 threshold calibrated post-UAT |
| `schema_version = hash(model \|\| dim)` only (v1.4) | Threshold/decay are query-time math applied to cached vectors — re-embedding on those changes is wasted compute | ✓ Good — D-14 invariant tested, prevents unnecessary cache busts |
| Pattern 7 (Adaptive Denial) for Voyage failures (v1.4) | 3-failure threshold + 15-min window persisted to `voyage-health.json` — graceful degradation without amplifying transient errors | ✓ Good — degraded state survives across CLI invocations |
| `/new` behavior untouched in v1.4 | Memory retrieval surfaces only via `/recall` and `/today` Memory Echo to avoid regressing working classifier | ✓ Good — UAT-01 unchanged through v1.4 |
| ASCII-only excluded-term matcher for v1.4 (Lock 5 Path B) | Unicode-variant matcher upgrade is a v1.5 feature, not v1.4 hygiene; 45 test.todo entries staged to document the gap without false-claiming behavior | ✓ Good — D-LOCK-5-AMEND-A held |
| RIGHT/daily-stats.md path with vault-relative resolution (v1.4) | Pattern 11 convention: vault-relative path + VAULT_ROOT runtime resolution via vault-gateway | ✓ Good — atomic .tmp+rename writes, idempotent same-day update |
| America/Chicago timezone for daily-stats date boundaries (v1.4) | Operator is in Fort Worth; ROADMAP success criterion citing America/Los_Angeles was an initial draft error corrected by REQ-AMEND-01 | ✓ Good — single shared `dateKey()` utility unit-tested at 23:59/00:01/DST boundaries |
| Manifest-first protocol for scoped governance work (v1.4 lesson) | Plan 21-03 caught 5 categorization corrections from CONTEXT estimates by building full N-row manifest before applying any changes | ✓ Good — protocol now codified in lessons.md as LESSON-MANIFEST-FIRST-VALIDATED-01 |
| `CI=true npm test` as the green/red signal (v1.4 lesson) | Bare `npm test` runs UAT tests against live API; `CI=true` triggers describe.skip guards and produces production-correctness signal | ✓ Good — codified in LESSON-PREFLIGHT-CI-MODE-01 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-26 after v1.5 milestone start*
