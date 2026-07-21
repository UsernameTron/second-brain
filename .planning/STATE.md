---
gsd_state_version: 1.0
milestone: v1.8
milestone_name: Measured Memory
status: in_progress
last_updated: "2026-07-19T23:45:00.000Z"
last_activity: 2026-07-19
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 5
  completed_plans: 1
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-15 after v1.7 milestone start)

**Core value:** Memory compounds daily. Every session, conversation, and capture adds to a growing knowledge base that makes tomorrow's work faster and more informed than today's.
**Status:** v1.8 Measured Memory in progress (1 of 5 phases complete)

## Current Position

Milestone: v1.8 Measured Memory — IN PROGRESS (Phases 32-36; Phase 36 decision-gated)
Phase: 32 Retrieval Eval Baseline — COMPLETE, shipped 2026-07-19 (PR #74). Baseline: keyword 0.900 / semantic 0.800 / hybrid 0.900 recall@5.
Status: Phase 33 (Capture Reliability) is next — requires observing one real 23:45 daily-sweep fire before changes
Last activity: 2026-07-21 - Quick task 260721-rst: fixed local-LLM reasoning starvation (reasoning_effort:none; verified live vs qwen3.6-27b)
Prior milestone: v1.7 Prove Compounding — SHIPPED and archived (PR #66 merged 2026-07-16); VERDICT-01 calendar-gated follow-up still open

**Shipped milestones:**

- v1.0 MVP (2026-04-22) — tag v1.0
- v1.1 Go Live (2026-04-23) — tag v1.1
- v1.2 Automation & Quality (2026-04-23) — tag v1.2.0
- v1.3 Review Remediation (2026-04-24) — tag v1.3.0
- v1.4 Memory Activation & Final Closeout (2026-04-26) — tag v1.4
- v1.5 Internal Hardening (2026-04-26) — tag v1.5
- v1.6 Enforcement Integrity & Surface Completion (2026-07-15)
- v1.7 Prove Compounding (2026-07-16) — PR #66

**Current milestone:** v1.8 Measured Memory (Phases 32-36) — Phase 32 complete 2026-07-19

## Accumulated Context

### Decisions

Full log in PROJECT.md Key Decisions table. Per-milestone summary:

- **v1.0/v1.1:** architectural + integration decisions (vault boundary, pipeline stages, connector topology)
- **v1.2:** automation & quality decisions (hooks, agents, CI, local LLM)
- **v1.3:** remediation decisions (config overlay, architecture decomposition, test quality focus)
- **v1.4:** memory activation decisions (Voyage embeddings calibrated 0.55 threshold, schema_version model+dim only, Pattern 7 degradation 3-fail/15-min, manifest-first protocol, ASCII-only matcher Path B, America/Chicago timezone, branch protection PR-required-reviews)
- **v1.5:** test-verifier dual-mode (Phase-Closure Verification Mode); memory health anomaly detector reads daily-stats rows
- **v1.6:** promotion safety (dry-run zero-side-effects, deferred-as-live-status), reach layer (ADR-019 pointer+digest, fail-closed egress), authority hierarchy (ADR-020), fail-closed semantic exclusions
- **v1.7 (2026-07-15, Pete):** launchd scheduler (RemoteTrigger is vault-unreachable — cloud env cannot write local vault); milestone closes at code-ship, verdict is a dated follow-up; delete 5 jest-polluted daily-counter cache files; verdict thresholds accepted (14 rows: entries +5, recall days ≥40%, hit rate ≥60%, week-2 ≥ week-1 − 10pts); query text never persisted (content policy)
- [Phase 30]: recordRecallInvocation moved to after results are known so hit/miss and resultCount are captured in the same call
- [Phase 30]: recordEchoShown guarded by mode !== 'dry-run' so practice /today runs never pollute echo counters
- [Phase 31-trend-report]: Pure compute/render split for compounding-trend engine (no I/O), thresholds hardcoded as Pete-accepted literals
- [Phase 31-trend-report]: CLI always prints the evidence table, including insufficient-data verdicts at <7 rows — Deliberately unlike the /today section (31-02), which suppresses the section below 7 rows -- the CLI is the archived audit trail and must show its work even when the verdict is inconclusive

### Open Blockers

**`master` has no branch protection.** Regression of BRANCH-PROT-01 (v1.4) — nothing stops a direct push to master with red CI. Repo-level setting, Pete's call, not a phase. Recommended restore: `required_pull_request_reviews` with `required_approving_review_count: 0`, plus `test (20)` / `test (22)` as required checks.

### Filed, not fixed

- **Rejected candidates never get `status::` rewritten** — `total_processed` re-counts them every run (pre-existing quirk, noted session 64).
- **Deferred hygiene:** `config/schema/daily-stats-frontmatter.schema.json` requires `schema_version` as string while `daily-stats.js` writes an integer. Latent — nothing validates written frontmatter. Relevant if frontmatter validation is ever wired into `readDailyStats` (v1.7 touches this file — re-check at plan time).
- **Desktop-chat userPreferences pointer line** — manual item from v1.6, confirm Pete pasted it.

### Pending Todos

None.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260426-mpy | Wire up missing slash commands and extract GSD knowledge into memory proposals | 2026-04-26 | 6dccf0b | [260426-mpy](./quick/260426-mpy-wire-up-missing-slash-commands-and-extra/) |
| 260719-lfn | Capture fixes: dotenv gate, embed counts, category validation, daily-sweep transcript+inbox capture, reach expansion (15 targets), launchd schedule | 2026-07-19 | 8c2a21c | [260719-lfn](./quick/260719-lfn-capture-fixes-dotenv-gate-embed-counts-c/) |
| 260719-llv | Memory reorg: 21 entries archived (archive-not-delete), 24 recategorized, auto-index, sidecar prune+heal to 135/135 parity | 2026-07-19 | 1f32e8b | [260719-llv](./quick/260719-llv-memory-reorg-archive-seed-dup-entries-re/) |
| 260721-rst | Fix local-LLM reasoning-model starvation: reasoning_effort:none disable (verified live vs qwen3.6-27b), reasoning-starved SHAPE_ERROR guard, 60s local timeout, default model → qwen3.6-27b | 2026-07-21 | 6d8c472 | [260721-rst](./quick/260721-rst-local-llm-reasoning-starvation/) |

## Session Continuity — Session 66 (2026-07-15)

**v1.6 archived (PR #64 merged). v1.7 Prove Compounding scoped and started.**

Plan-mode investigation findings that ground the v1.7 requirements (verified against repo + vault + cache):

- `RIGHT/daily-stats.md` **does not exist** — `recordDailyStats()` only fires at end of non-dry-run `/today`, and none has ever run. `config/scheduling.json` trigger is `"enabled": false`; even enabled, RemoteTrigger runs in cloud env `env_01TjBJ...` which cannot reach `VAULT_ROOT=~/Claude Cowork`. The April "verified fire" wrote into the void.
- **Counter cache polluted by jest:** `~/.cache/second-brain/daily-counters-2026-07-15.json` shows 8875 proposals / 1714 promotions / 655 recalls. Tests call `record*` without `CACHE_DIR_OVERRIDE` (only 6 test files set it). Root fix: guard `_counterPath()` on `JEST_WORKER_ID`.
- **No utility signal captured:** Memory Echo shown/score never logged (only latency); recall hit/miss and result counts not persisted; `topCosineScores[]`/`topRrfScores[]` are emit-only (D-07), never read back.
- **No trend code:** only consumers of stats history are `buildYesterdaySummaryLine` (1-day delta, string-coercion fragile) and `computeMemoryHealth` (needs ≥3 rows, never fired).
- Approved plan: `/Users/cpconnor/.claude/plans/craete-a-plan-to-bright-cookie.md` (phases 29–31 + verdict follow-up, file-level changes, test approach).

## Next Action

`/gsd:plan-phase 29` (Series Integrity). Merge `chore/v1.7-milestone-init` via PR first.
