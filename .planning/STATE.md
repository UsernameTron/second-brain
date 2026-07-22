---
gsd_state_version: 1.0
milestone: v1.8
milestone_name: Measured Memory
status: in_progress
last_updated: "2026-07-21T00:00:00.000Z"
last_activity: 2026-07-21
progress:
  total_phases: 5
  completed_phases: 4
  total_plans: 13
  completed_plans: 13
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-15 after v1.7 milestone start)

**Core value:** Memory compounds daily. Every session, conversation, and capture adds to a growing knowledge base that makes tomorrow's work faster and more informed than today's.
**Status:** v1.8 phases 32-35 shipped; Phase 36 decision-gated

## Current Position

Milestone: v1.8 Measured Memory — Phases 32-35 SHIPPED (32: PR #74 2026-07-19; 33: PR #88, 34: PR #86 + close-out #87, 35: PR #89 — all 2026-07-21). Phase dirs archived to milestones/v1.8-phases/.
Phase 36 (Ingest Breadth): decision-gated, unscheduled — gate is a real L10 RAG Phase 3 timeline. Pete's call.
Last activity: 2026-07-21 (full project audit & close-out session)
Prior milestone: v1.7 Prove Compounding — SHIPPED and archived (PR #66 merged 2026-07-16); VERDICT-01 calendar-gated follow-up still open (due ~2026-08-06: ≥14 weekday daily-stats rows)

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

- **Desktop-chat userPreferences pointer line** — manual item from v1.6, confirm Pete pasted it.
- **`daily-stats-frontmatter.schema.json` `schema_version` type mismatch** — schema says string, writer writes integer (`src/daily-stats.js:197`, `config/pipeline.json` numeric 1). Latent (nothing validates written frontmatter yet). Fix is one line — `"type": "string"` → `"type": "integer"` — but `config/schema/` is protected-file-guarded; needs Pete's manual approval. (2026-07-21 audit: attempted, blocked by guard as designed.)

(Resolved 2026-07-21 audit: rejected-candidates `status::` rewrite had already shipped in c0b3c70 (PROMOTE-REJECT-01) — line removed.)

### Pending Todos

None.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260426-mpy | Wire up missing slash commands and extract GSD knowledge into memory proposals | 2026-04-26 | 6dccf0b | [260426-mpy](./quick/260426-mpy-wire-up-missing-slash-commands-and-extra/) |
| 260719-lfn | Capture fixes: dotenv gate, embed counts, category validation, daily-sweep transcript+inbox capture, reach expansion (15 targets), launchd schedule | 2026-07-19 | 8c2a21c | [260719-lfn](./quick/260719-lfn-capture-fixes-dotenv-gate-embed-counts-c/) |
| 260719-llv | Memory reorg: 21 entries archived (archive-not-delete), 24 recategorized, auto-index, sidecar prune+heal to 135/135 parity | 2026-07-19 | 1f32e8b | [260719-llv](./quick/260719-llv-memory-reorg-archive-seed-dup-entries-re/) |
| 260721-rst | Fix local-LLM reasoning-model starvation: reasoning_effort:none disable (verified live vs qwen3.6-27b), reasoning-starved SHAPE_ERROR guard, 60s local timeout, default model → qwen3.6-27b | 2026-07-21 | 6d8c472 | [260721-rst](./quick/260721-rst-local-llm-reasoning-starvation/) |
| 260721-gyj | Memory wiki optimization: lesson→LEARNING alias + silent coercion (5 notes stripped, 0 remain), related:: wikilinks at promotion + 180-entry backfill (98.9% coverage, unique ^hash block anchors), reader field-parse root-cause fix, sidecar parity 180/180 | 2026-07-21 | df1a484 | [260721-gyj](./quick/260721-gyj-memory-wiki-optimization-category-fix-re/) |
| 260721-ljn | Session close-out batch (verified): dream-apply gate docs fixed (SKILL.md + 4 dream.js sites), scheduled dream pinned to Anthropic via LLM_PROVIDER (launchctl-live), changeset confirmed resolved 12+3-rejected (apply no-op, rejections preserved), wiki graph refreshed 178/180 (98.9%) via pinned Haiku after LM Studio wedge, phase-34 branch deleted; suite 1440 passed | 2026-07-21 | 2d26ea4 | [260721-ljn](./quick/260721-ljn-session-close-out-batch-dream-apply-skil/) |

## Session Continuity — Session 66 (2026-07-15)

**v1.6 archived (PR #64 merged). v1.7 Prove Compounding scoped and started.**

Plan-mode investigation findings that ground the v1.7 requirements (verified against repo + vault + cache):

- `RIGHT/daily-stats.md` **does not exist** — `recordDailyStats()` only fires at end of non-dry-run `/today`, and none has ever run. `config/scheduling.json` trigger is `"enabled": false`; even enabled, RemoteTrigger runs in cloud env `env_01TjBJ...` which cannot reach `VAULT_ROOT=~/Claude Cowork`. The April "verified fire" wrote into the void.
- **Counter cache polluted by jest:** `~/.cache/second-brain/daily-counters-2026-07-15.json` shows 8875 proposals / 1714 promotions / 655 recalls. Tests call `record*` without `CACHE_DIR_OVERRIDE` (only 6 test files set it). Root fix: guard `_counterPath()` on `JEST_WORKER_ID`.
- **No utility signal captured:** Memory Echo shown/score never logged (only latency); recall hit/miss and result counts not persisted; `topCosineScores[]`/`topRrfScores[]` are emit-only (D-07), never read back.
- **No trend code:** only consumers of stats history are `buildYesterdaySummaryLine` (1-day delta, string-coercion fragile) and `computeMemoryHealth` (needs ≥3 rows, never fired).
- Approved plan: `/Users/cpconnor/.claude/plans/craete-a-plan-to-bright-cookie.md` (phases 29–31 + verdict follow-up, file-level changes, test approach).

## Next Action

Pete decisions, in order:
1. VERDICT-01 (~2026-08-06): run `node scripts/compounding-report.js` once ≥14 weekday rows exist; archive output + verdict to `.planning/`.
2. Phase 36 gate: open (define requirements, plan, execute) or close v1.8 without it (`/gsd:complete-milestone`).
3. Branch protection on master (open blocker above) — repo settings, one-time.
