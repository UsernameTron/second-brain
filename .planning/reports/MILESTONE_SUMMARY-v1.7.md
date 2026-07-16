# Milestone Summary — v1.7 Prove Compounding

Generated: 2026-07-16 · Phases 29–31 · PR #66 (`chore/v1.7-milestone-init` → master)

## 1. Overview

v1.7 exists to prove — or honestly refute — the project's core thesis: **"memory compounds daily."** A 2026-07-15 investigation found the evidence layer empty and partially broken: `daily-stats.md` had never been written (the cloud RemoteTrigger could not reach the local vault), the per-day counter cache was polluted by jest, no retrieval-utility signal existed, and nothing computed trends. This milestone shipped the full evidence pipeline in three phases. The binding verdict is deliberately NOT in this milestone: VERDICT-01 is calendar-gated ~3 weeks post-ship, once ~14 real weekday rows exist. An honest `flat` or `refuted` outcome is an accepted result.

## 2. Architecture

Evidence flows one direction, with a single pure decision function shared by both surfaces:

```
launchd (weekdays 06:45, com.secondbrain.today)
  → /today scheduled run
    → flushMissedDays() (idempotent catch-up, 14-day counter cleanup)
    → recordDailyStats() — 11-column row in RIGHT/daily-stats.md
  /recall → recordRecallInvocation(hit/miss, count) — query text never persisted
  /today  → recordEchoShown(shown, score)

readDailyStats (numeric coercion at the root)
  → computeCompoundingTrend(rows, {windowDays: 14})   [pure, zero I/O]
    → /today "## Compounding" section (suppressed <7 rows)
    → scripts/compounding-report.js CLI (always prints evidence table)
```

Key properties: jest can never pollute production counters (JEST_WORKER_ID guard routes test writes to temp dirs); both verdict surfaces call the identical pure function, so they can never disagree; missed days are gaps, not zeros.

## 3. Phases

### Phase 29 — Series Integrity (STATS-PIPE-01/02/03) · verified 4/4
- JEST_WORKER_ID-guarded counter cache + `CACHE_DIR_OVERRIDE`, with regression tripwire test.
- `flushMissedDays()`: idempotent flush of orphan-day counters into rows, ~14-day cleanup.
- Local launchd job `com.secondbrain.today` (weekdays 06:45) replaces the vault-unreachable cloud RemoteTrigger; `config/scheduling.json` documents the fallback chain.

### Phase 30 — Outcome Instrumentation (STATS-OUTCOME-01/02) · verified 6/6 + live human checkpoint
- 11-column daily-stats schema (adds `recall_hits`, `echo_shown`, `echo_score`); frontmatter self-heals older files.
- `/recall` records hit/miss + result count *after* results are known; `/today` records Memory Echo shown/score.
- Live human-verified row on the real vault with zero query-text leakage (operator approved 2026-07-16).

### Phase 31 — Trend & Report (TREND-01/02) · verified 4/4, UAT 3/3
- Pure `computeCompoundingTrend`: supply (entries +5, kb growth) / demand (recall ≥40% of days) / utility (hit rate ≥60%, wk2 ≥ wk1 −10pts) gates → `compounding | flat | insufficient-data`.
- `/today` `## Compounding` section, suppressed entirely below 7 rows (Memory Echo null-suppression precedent).
- `scripts/compounding-report.js`: always prints the full evidence table — the archived report is the audit trail.

## 4. Key Decisions

- **Verdict thresholds** (Pete accepted 2026-07-15, 14-row window): entries +5 and kb growth; recall used ≥40% of days; hit rate ≥60%; wk2 ≥ wk1 − 10pts. Verdicts on 7–13 rows are labeled *provisional*.
- **Two surfaces, two policies:** `/today` suppresses below 7 rows (briefing stays clean); the CLI always shows its work (audit trail).
- **Windowing by row count, not calendar:** missed days are gaps, never zeros — absence of data is not evidence of decline.
- **Local scheduler over cloud:** RemoteTrigger stays disabled by design; cloud cannot reach the local vault.
- **Test isolation architecture:** integration tests for lazily-required modules live in dedicated files with hoisted `jest.mock` (per-suite `doMock` never reaches call-time requires).

## 5. Requirements

All 7 code REQ-IDs complete and 3-source cross-verified (traceability, VERIFICATION tables, SUMMARY frontmatter): STATS-PIPE-01/02/03, STATS-OUTCOME-01/02, TREND-01/02. VERDICT-01 deferred by design (calendar-gated follow-up).

## 6. Tech Debt & Deferred

- **Dependencies (FLAG, backlogged):** @anthropic-ai/sdk 0.90 moderate CVE — fix requires major bump to 0.111; chokidar 3.6→5.0; voyageai 0.2.1→0.4.0; eslint/jest bumps clear 3 dev-transitive CVEs. See `.planning/dependencies/DEPENDENCIES-REPORT.md`.
- **`eslint.config.js` lacks a `scripts/**` block** — `scripts/*.js` files aren't linted as CommonJS entry points (pre-existing; `31-trend-report/deferred-items.md`).
- **v1.0-era human UAT:** 3 subjective items pending in `02-HUMAN-UAT.md` (classification feel, wikilink relevance, promotion UX).
- **VERDICT-01:** ~3 weeks post-ship — confirm scheduler alive over a trailing week, observe `computeMemoryHealth` live, archive the compounding report with the verdict.

## 7. Getting Started (new team member)

1. Read `.planning/PROJECT.md`, then this summary.
2. Run `node scripts/compounding-report.js` — the whole thesis in one command.
3. Trace the pipeline: `src/daily-stats.js` (rows) → `src/today/compounding-trend.js` (verdict) → `src/today/briefing-renderer.js` (surface).
4. Stats: 1285 tests / 67 files (1247 pass, 38 CI-skipped); coverage S 91.95 / B 81.44 / F 96.00 / L 92.64.
