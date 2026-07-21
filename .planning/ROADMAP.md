# Roadmap: Second Brain

## Overview

Transform an Obsidian vault into a personal operating system with compounding memory, proactive daily briefing, intelligent input routing, and external integrations.

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped 2026-04-22)
- ✅ **v1.1 Go Live** — Phases 5-7 (shipped 2026-04-23)
- ✅ **v1.2 Automation & Quality** — Phases 8-11 (shipped 2026-04-23, tag v1.2.0)
- ✅ **v1.3 Review Remediation** — Phases 12-16 (shipped 2026-04-24, tag v1.3.0)
- ✅ **v1.4 Memory Activation & Final Closeout** — Phases 17-21 (shipped 2026-04-26, tag v1.4)
- ✅ **v1.5 Internal Hardening** — Phases 22-25 (shipped 2026-04-26, tag v1.5)
- ✅ **v1.6 Enforcement Integrity & Surface Completion** — Phases 26-28 (shipped 2026-07-15, tag v1.6)
- ✅ **v1.7 Prove Compounding** — Phases 29-31 (shipped 2026-07-16, PR #66)
- 🚧 **v1.8 Measured Memory** — Phases 32-36 (Phase 32 shipped 2026-07-19 via PR #74; 33-35 planned, 36 decision-gated)

## Phases

<details open>
<summary>🚧 v1.8 Measured Memory (Phases 32-36) — IN PROGRESS (planned 2026-07-19; Phase 32 shipped 2026-07-19)</summary>

**Prerequisite:** merge `feat/second-brain-capture-verification` (11 commits ahead of origin/master at planning time) to master before execution. — DONE.

- [x] Phase 32: Retrieval Eval Baseline — SHIPPED 2026-07-19 (PR #74). `npm run eval:recall` scores a 20-question golden set (`eval/golden-recall.json`, keyed by `content_hash`) over a frozen 135-entry seed vault with an isolated embeddings cache; recall@5 + MRR across keyword/semantic/hybrid. Baseline committed before any tuning: **keyword 0.900 / semantic 0.800 / hybrid 0.900 recall@5** (`eval/baseline-2026-07-19.json`). Two consecutive runs agreed exactly; live cache byte-identical; gate drills confirm the harness cannot silently pass. Open lead for tuning: semantic misses q10/q17 by returning nothing above the 0.55 threshold. Plan: `milestones/v1.8-phases/32-retrieval-eval/32-01-PLAN.md` · Notes: `32-01-NOTES.md`
- [ ] Phase 33: Capture Reliability — fix + version the `com.secondbrain.daily-sweep` launchd plist (verified never-fired at planning: no log file; bare `node`, no env/WorkingDirectory) and observe one real 23:45 fire FIRST; persist `state/daily-sweep-last-run.json`; `/today` Compounding line "sweep ran/staged N | STALE | NEVER RAN"; `src/utils/classifier-health.js` (voyage-health clone) gating local-27B → `classifyAnthropic` fallback, extended to HTTP/parse errors, with per-night Haiku call cap.
- [ ] Phase 34: Promotion Integrity & Lifecycle — land filed backlog PROMOTE-PARSE-01 / PROMOTE-VAULT-01 / PROMOTE-ID-01 / VERIFY-SENTINEL-01 (`scripts/verify-baseline.js`, real exit code); contradiction check at promotion (hybrid top-5, flag-only, never block/auto-resolve); `superseded-by::` entry convention (readMemory downranks); monthly snapshot-first dream-consolidation script + launchd plist (stages for human review, no auto-apply) codifying the 2026-07-19 manual reorg. **Planned 2026-07-20: 7 plans, 5 waves.**
  - [x] 34-01-PLAN.md — Promotion gate integrity: shared `parseCheckboxState` extraction (operator hard constraint) + PROMOTE-PARSE-01 whitespace/near-miss + PROMOTE-VAULT-01 call-time root + PROMOTE-ID-01 collision-safe IDs (wave 1)
  - [x] 34-02-PLAN.md — `superseded-by::` / `stale::` read-path downrank in memory-reader.js (wave 1)
  - [x] 34-03-PLAN.md — VERIFY-SENTINEL-01: `scripts/verify-baseline.js` real exit code over the 27 pre-governance hashes + pre-push gate (wave 1)
  - [x] 34-04-PLAN.md — Shared `checkContradiction` helper + flag-only contradiction surfacing at promotion (wave 2)
  - [x] 34-05-PLAN.md — Dream config block + MERGE (mechanical quote guard) + STALE detection (wave 3)
  - [x] 34-06-PLAN.md — Dream MISSED PATTERNS + changeset writer (shared parser) + `/dream-propose` CLI + monthly plist (wave 4)
  - [x] 34-07-PLAN.md — Dream `/dream-apply`: snapshot-first + apply + `eval:recall` gate with auto-restore, human-only (wave 5)
- [ ] Phase 35: Proactive Memory — SessionStart hook `.claude/hooks/session-memory-inject.js` (fail-open on infra, exit 0 always) shelling to `scripts/recall.js "<project-derived query>" --hybrid --top 5`, entries passed through the reach exporter's fail-closed `checkContent` egress loop; ~750-token hard cap; kill switch `sessionInject.enabled` + `SB_SESSION_INJECT=0`; latency gate (<1s Voyage-up, <250ms degraded).
- [ ] Phase 36 (decision-gated, unscheduled): Ingest Breadth — Drive connector behind the `src/connectors/types.js` contract PLUS the missing connector→memory seam (no connector feeds memory.md today — gmail/calendar/github are briefing-only). Build once here, L10 RAG consumes it; do not fork. Gate: real L10 Phase 3 timeline.

Ordering rationale: eval first (no recall claim is provable without a baseline — zero eval infra existed at planning); capture second (scheduler live-broken); lifecycle before injection (inject from a store with integrity checks).

</details>

<details>
<summary>✅ v1.7 Prove Compounding (Phases 29-31) — SHIPPED 2026-07-16 (PR #66)</summary>

- [x] Phase 29: Series Integrity
- [x] Phase 30: Outcome Instrumentation
- [x] Phase 31: Trend & Report

Full details: [milestones/v1.7-ROADMAP.md](milestones/v1.7-ROADMAP.md)
Audit: [milestones/v1.7-MILESTONE-AUDIT.md](milestones/v1.7-MILESTONE-AUDIT.md)

Post-milestone follow-up (calendar-gated, ~3 weeks after ship, not a roadmap phase): VERDICT-01 — confirm scheduler alive over a trailing week, observe `computeMemoryHealth` live, archive `scripts/compounding-report.js` output with the verdict to `.planning/`.

</details>

<details>
<summary>✅ v1.6 Enforcement Integrity & Surface Completion (Phases 26-28) — SHIPPED 2026-07-15</summary>

- [x] Phase 26: Promotion Safety — completed 2026-07-15 (PR #62)
- [x] Phase 27: Context Honesty (3/3 plans) — completed 2026-07-15 (PR #63)
- [x] Phase 28: Surface Completion (3/3 plans) — completed 2026-07-15 (PR #63)

Full details: [milestones/v1.6-ROADMAP.md](milestones/v1.6-ROADMAP.md)
Audit: [milestones/v1.6-MILESTONE-AUDIT.md](milestones/v1.6-MILESTONE-AUDIT.md)

</details>

<details>
<summary>✅ v1.4 Memory Activation & Final Closeout (Phases 17-21) — SHIPPED 2026-04-26</summary>

- [x] Phase 17: UAT CI Infrastructure (3/3 plans) — completed 2026-04-24
- [x] Phase 18: Memory Retrieval Foundation (6/6 plans) — completed 2026-04-24
- [x] Phase 19: Semantic Memory Search (5/5 plans) — completed 2026-04-24
- [x] Phase 20: Value Extraction Instrumentation (5/5 plans) — completed 2026-04-25
- [x] Phase 21: Closeout Hygiene (4/4 plans) — completed 2026-04-26

Full details: [milestones/v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md)
Audit: [milestones/v1.4-MILESTONE-AUDIT.md](milestones/v1.4-MILESTONE-AUDIT.md)

</details>

<details>
<summary>✅ v1.3 Review Remediation (Phases 12-16) — SHIPPED 2026-04-24</summary>

- [x] Phase 12: Critical Safety Fixes (6/6 plans) — completed 2026-04-23
- [x] Phase 13: Config Schema Gaps — completed 2026-04-23
- [x] Phase 14: CI Hardening (5/5 plans) — completed 2026-04-24
- [x] Phase 15: Architecture Refactor — completed 2026-04-24
- [x] Phase 16: Test Quality — completed 2026-04-24

Full details: [milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md)

</details>

<details>
<summary>✅ v1.2 Automation & Quality (Phases 8-11) — SHIPPED 2026-04-23 (tag v1.2.0)</summary>

- [x] Phase 8: Hook Infrastructure (3/3 plans) — completed 2026-04-23
- [x] Phase 9: Security & Verification (3/3 plans) — completed 2026-04-23
- [x] Phase 10: Agent Hardening & Skills (2/2 plans) — completed 2026-04-23
- [x] Phase 11: CI & LLM Infrastructure (2/2 plans) — completed 2026-04-23

Full details (when archived): see `.planning/milestones/`

</details>

<details>
<summary>✅ v1.1 Go Live (Phases 5-7) — SHIPPED 2026-04-23</summary>

- [x] Phase 5: Integration Wiring (3/3 plans) — completed 2026-04-23
- [x] Phase 6: Defect Fixes and UAT (3/3 plans) — completed 2026-04-23
- [x] Phase 7: Hardening (1/1 plan) — completed 2026-04-23

Full details: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

</details>

<details>
<summary>✅ v1.0 MVP (Phases 1-4) — SHIPPED 2026-04-22</summary>

- [x] Phase 1: Vault Foundation (2/2 plans) — completed 2026-04-21
- [x] Phase 2: Content Pipeline (6/6 plans) — completed 2026-04-21
- [x] Phase 3: External Integrations (4/4 plans) — completed 2026-04-22
- [x] Phase 4: Daily Briefing and Scheduling (3/3 plans) — completed 2026-04-22

Full details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

<details>
<summary>✅ v1.5 Internal Hardening (Phases 22-25) — SHIPPED 2026-04-26</summary>

- [x] Phase 22: Committed Hooks (2/2 plans) — completed 2026-04-26
- [x] Phase 23: Doc Sync Layer (2/2 plans) — completed 2026-04-26
- [x] Phase 24: Agent Surface (2/2 plans) — completed 2026-04-26
- [x] Phase 25: Unicode Hardening & UAT Closeout (2/2 plans) — completed 2026-04-26

Full details: [milestones/v1.5-phases/](milestones/v1.5-phases/)

</details>

## Phase Details

### Phase 29: Series Integrity
**Goal**: A clean daily-stats row lands every weekday without test-suite pollution corrupting the counter cache
**Depends on**: Phase 28 (v1.6 complete)
**Requirements**: STATS-PIPE-01, STATS-PIPE-02, STATS-PIPE-03
**Success Criteria** (what must be TRUE):
  1. Running the jest suite leaves `~/.cache/second-brain` daily-counter files untouched — a regression tripwire test asserts counter writes resolve under a temp dir when `JEST_WORKER_ID` is set (unless `CACHE_DIR_OVERRIDE` is explicitly set)
  2. A day where `/today` never ran has its counters flushed into a `daily-stats.md` row on the next real `/today`, without duplicating rows already present (idempotent via existing `recordDailyStats`)
  3. Counter files older than ~14 days are deleted after a successful flush
  4. `launchctl list | grep secondbrain` shows the `com.secondbrain.today` job loaded for weekday 06:45 local execution, and `config/scheduling.json` documents RemoteTrigger as vault-unreachable (disabled by design, not a config bug)
  5. The 5 pre-existing jest-polluted counter files are deleted from `~/.cache/second-brain/`
**Plans**: 2 plans

Plans:
- [x] 29-01-PLAN.md — Counter-store integrity: JEST_WORKER_ID pollution guard + tripwire test, polluted-file cleanup, missed-day flush + 14-day retention
- [x] 29-02-PLAN.md — launchd weekday scheduler (com.secondbrain.today) + RemoteTrigger disabled-by-design documentation

### Phase 30: Outcome Instrumentation
**Goal**: Daily-stats rows capture whether retrieval returned value, not just that it ran
**Depends on**: Phase 29
**Requirements**: STATS-OUTCOME-01, STATS-OUTCOME-02
**Success Criteria** (what must be TRUE):
  1. Every `/recall` invocation increments a new `recall_hits` counter when at least one result was returned and the query wasn't blocked, alongside the existing `recall_count`; the query text itself is never written to any counter or stats file
  2. Every non-dry-run `/today` records whether Memory Echo was shown and its top score, in new `echo_shown` / `echo_score` fields
  3. A real `/today` run produces a `daily-stats.md` row with 11 columns (8 existing + `recall_hits`, `echo_shown`, `echo_score`)
  4. `readDailyStats()` returns numeric types for numeric cells and preserves `—` as a string for missing data, verified by a round-trip test
**Plans**: 3 plans

Plans:
- [x] 30-01-PLAN.md — daily-stats data layer: counters, recordEchoShown, 11-column schema, numeric coercion
- [x] 30-02-PLAN.md — command wiring: /recall hit/miss + /today echo outcome and 11-column row
- [x] 30-03-PLAN.md — live human-verify checkpoint: 11-column row, no query-text leakage

### Phase 31: Trend & Report
**Goal**: A pure trend function turns the daily-stats series into an honest verdict, surfaced in both `/today` and a standalone CLI
**Depends on**: Phase 30
**Requirements**: TREND-01, TREND-02
**Success Criteria** (what must be TRUE):
  1. `computeCompoundingTrend(rows, { windowDays })` returns supply/demand/utility metrics and a `compounding | flat | insufficient-data` verdict per the accepted thresholds, with no I/O (pure, unit-testable with synthetic rows)
  2. With fewer than 7 rows, the verdict is `insufficient-data` and the `/today` Compounding section is suppressed (matches the Memory Echo null-suppression precedent)
  3. With ≥7 rows, `/today` displays a `## Compounding` section reflecting the same verdict the pure function computes for the same rows
  4. `node scripts/compounding-report.js` prints the full evidence table plus verdict as markdown, reading `daily-stats.md` via the existing `readDailyStats`; at <7 rows it correctly prints the `insufficient-data` verdict with the evidence table
**Plans**: 3 plans

Plans:
- [x] 31-01-PLAN.md — Pure computeCompoundingTrend verdict function + renderCompoundingReport markdown renderer (TDD)
- [x] 31-02-PLAN.md — /today ## Compounding section with <7-row null-suppression
- [x] 31-03-PLAN.md — Standalone scripts/compounding-report.js CLI (evidence table + verdict, always prints table)

### Phase 22: Committed Hooks
**Goal**: The git pre-commit layer enforces schema validity, vault boundary integrity, and dotenv discipline automatically — no manual review needed to catch these classes of defects
**Depends on**: Phase 21 (v1.4 complete)
**Requirements**: HOOK-SCHEMA-01, HOOK-VAULT-01, HOOK-DOTENV-01
**Success Criteria** (what must be TRUE):
  1. Attempting to commit a malformed `daily-stats.md` frontmatter or out-of-bounds `config/pipeline.json` value fails at `git commit` time with a descriptive AJV error
  2. Attempting to commit a file to the wrong vault side (LEFT vs RIGHT) is blocked by the pre-commit hook before the commit lands
  3. `dotenv.config()` calls exist only at entry points; no library module re-loads env at import time; `src/pipeline-infra.js:23` root cause is resolved
  4. All three hooks are committed to `.git/hooks/` (or equivalent project hook config) and activate automatically for new checkouts
**Plans:** 3/3 plans complete

Plans:
- [x] 22-01-PLAN.md -- Pre-commit schema validation (AJV) and vault boundary enforcement hooks
- [x] 22-02-PLAN.md -- Dotenv entry-point refactor (remove side-effect from pipeline-infra.js)

### Phase 23: Doc Sync Layer
**Goal**: Documentation drift between living docs and code reality is detected automatically — once at merge time (non-blocking warning) and once at phase closure (blocking if threshold exceeded)
**Depends on**: Phase 22
**Requirements**: HOOK-DOCSYNC-01, AGENT-DOCSYNC-01
**Success Criteria** (what must be TRUE):
  1. After a merge to master, the post-merge hook compares `CLAUDE.md`/`README.md` stats (test count, coverage) against live `jest --coverage` output and prints a warning if any stat is stale
  2. At phase closure, the `docs-sync` agent compares living-doc narrative against `jest --coverage` and `git log` reality and blocks closure if any stat drift exceeds the configured threshold
  3. A correctly synced state produces no warnings or block from either the hook or the agent
**Plans:** 2/2 plans complete

Plans:
- [x] 23-01-PLAN.md — Post-merge hook with drift detection, threshold config, and tests
- [x] 23-02-PLAN.md — Extend docs-sync agent with Phase-Closure Audit Mode

### Phase 24: Agent Surface
**Goal**: Requirement coverage is automatically verifiable at phase close, and memory health anomalies surface in the daily briefing before they compound into data quality problems
**Depends on**: Phase 22
**Requirements**: AGENT-VERIFY-01, AGENT-MEMORY-01
**Success Criteria** (what must be TRUE):
  1. At phase-close time, `test-verifier` spawns parallel sub-checks per REQ-ID and returns a pass/fail verdict for every requirement in the phase — not just a bulk coverage number
  2. `/today` includes a memory health section when any anomaly condition is met: zero promotions for 3+ consecutive days, backlog growth trend, recall usage drop, or vault plateau
  3. Memory health section is absent (no false alerts) when daily-stats counters show normal operation
**Plans**: TBD

### Phase 25: Unicode Hardening & UAT Closeout
**Goal**: Excluded-term matching is Unicode-safe and auditably correct, the UAT classification corpus reflects current classifier behavior, and the Phase 17 UAT workflow smoke run is confirmed complete
**Depends on**: Phase 24
**Requirements**: HYG-UNICODE-02, UAT-REFRESH-01, UAT-SMOKE-01
**Success Criteria** (what must be TRUE):
  1. The 45 `test.todo()` blocks in `test/content-policy.test.js` are promoted to passing tests that cover Unicode-variant inputs (e.g., café, naïve, résumé forms) against the excluded-terms list
  2. `src/content-policy.js:160,201` uses NFKD-normalized matching; ASCII-only `.toLowerCase().includes()` is removed
  3. `test/uat/uat-classification.test.js` produces a meaningful accuracy score locally against the rebaselined corpus — no stale or ambiguous fixture data
  4. `gh workflow run uat.yml` fires, executes to completion, and a UAT accuracy report artifact is available in GitHub Actions (Phase 17 carry-forward closed)
**Plans:** 2 plans

Plans:
- [ ] 25-01-PLAN.md -- NFKD-normalized Unicode matcher and 45 promoted test assertions
- [ ] 25-02-PLAN.md -- UAT corpus rebaseline and Phase 17 workflow smoke run

**UI hint**: no

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Vault Foundation | v1.0 | 2/2 | Complete | 2026-04-21 |
| 2. Content Pipeline | v1.0 | 6/6 | Complete | 2026-04-21 |
| 3. External Integrations | v1.0 | 4/4 | Complete | 2026-04-22 |
| 4. Daily Briefing and Scheduling | v1.0 | 3/3 | Complete | 2026-04-22 |
| 5. Integration Wiring | v1.1 | 3/3 | Complete | 2026-04-23 |
| 6. Defect Fixes and UAT | v1.1 | 3/3 | Complete | 2026-04-23 |
| 7. Hardening | v1.1 | 1/1 | Complete | 2026-04-23 |
| 8. Hook Infrastructure | v1.2 | 3/3 | Complete | 2026-04-23 |
| 9. Security & Verification | v1.2 | 3/3 | Complete | 2026-04-23 |
| 10. Agent Hardening & Skills | v1.2 | 2/2 | Complete | 2026-04-23 |
| 11. CI & LLM Infrastructure | v1.2 | 2/2 | Complete | 2026-04-23 |
| 12. Critical Safety Fixes | v1.3 | 6/6 | Complete | 2026-04-23 |
| 13. Config Schema Gaps | v1.3 | — | Complete | 2026-04-23 |
| 14. CI Hardening | v1.3 | 5/5 | Complete | 2026-04-24 |
| 15. Architecture Refactor | v1.3 | — | Complete | 2026-04-24 |
| 16. Test Quality | v1.3 | — | Complete | 2026-04-24 |
| 17. UAT CI Infrastructure | v1.4 | 3/3 | Complete | 2026-04-24 |
| 18. Memory Retrieval Foundation | v1.4 | 6/6 | Complete | 2026-04-24 |
| 19. Semantic Memory Search | v1.4 | 5/5 | Complete | 2026-04-24 |
| 20. Value Extraction Instrumentation | v1.4 | 5/5 | Complete | 2026-04-25 |
| 21. Closeout Hygiene | v1.4 | 4/4 | Complete | 2026-04-26 |
| 22. Committed Hooks | v1.5 | 0/2 | Complete    | 2026-04-26 |
| 23. Doc Sync Layer | v1.5 | 2/2 | Complete    | 2026-04-26 |
| 24. Agent Surface | v1.5 | 2/2 | Complete    | 2026-04-26 |
| 25. Unicode Hardening & UAT Closeout | v1.5 | 2/2 | Complete    | 2026-04-26 |
| 26. Promotion Safety | v1.6 | — | Complete | 2026-07-15 |
| 27. Context Honesty | v1.6 | 3/3 | Complete | 2026-07-15 |
| 28. Surface Completion | v1.6 | 3/3 | Complete | 2026-07-15 |
| 29. Series Integrity | v1.7 | 2/2 | Complete    | 2026-07-15 |
| 30. Outcome Instrumentation | v1.7 | 3/3 | Complete    | 2026-07-16 |
| 31. Trend & Report | v1.7 | 2/3 | Complete    | 2026-07-16 |
| 32. Retrieval Eval Baseline | v1.8 | 1/1 | Complete    | 2026-07-19 |
