---
phase: 31-trend-report
plan: 02
subsystem: today-briefing
tags: [trend-analysis, daily-stats, briefing, null-suppression]

requires:
  - phase: 31-trend-report
    provides: "computeCompoundingTrend/renderCompoundingReport pure functions (31-01, src/today/compounding-trend.js)"
provides:
  - "## Compounding section in the /today briefing — verdict + metrics + evidence table, suppressed entirely when verdict is insufficient-data (<7 rows)"
affects:
  - "31-03 (CLI) shares the identical verdict via the same pure functions"

tech-stack:
  added: []
  patterns:
    - "Null-suppression section pattern (Memory Echo / Memory Health precedent): compute body-or-null in runToday, conditional spread ['## Compounding', '', body, ''] in briefing-renderer"
    - "Lazy requires inside runToday try-block per Pattern 12; silent catch — briefing-is-the-product"

key-files:
  created:
    - test/today-command.compounding.test.js
  modified:
    - src/today-command.js
    - src/today/briefing-renderer.js
    - test/today/briefing-renderer.test.js

key-decisions:
  - "Compounding integration tests live in a dedicated file (test/today-command.compounding.test.js), not today-command.test.js: runToday lazy-requires daily-stats/pipeline-infra at CALL time, and the main test file's layered per-suite doMock registries leak into those runtime requires (jest.isolateModules sandboxes are discarded before the lazy require fires). Hoisted jest.mock in a dedicated file is the only registry those requires can reliably see."
  - "Section suppressed (heading and body absent) below 7 rows — matches Memory Echo / Memory Health null-suppression precedent; the CLI (31-03) is the surface that always shows the table."

patterns-established:
  - "Integration tests for lazily-required modules go in dedicated test files with hoisted jest.mock — per-suite doMock inside a shared file does not reach call-time requires"

requirements-completed: [TREND-02]

duration: 25min
completed: 2026-07-16
---

# Phase 31 Plan 02: /today Compounding Section Summary

**`/today` now computes the compounding trend from daily-stats rows and renders a `## Compounding` section (verdict, three metric bullets, evidence table), suppressed entirely when fewer than 7 rows exist — following the Memory Echo / Memory Health null-suppression precedent.**

## What was built

- `src/today-command.js`: new non-fatal block after Memory Health — when `config.stats.enabled`, lazily requires the 31-01 trend engine and `readDailyStats`, computes the trend over a 14-row window, and passes `compounding` (body string or null) to `renderBriefing`.
- `src/today/briefing-renderer.js`: `renderBriefing` destructures `compounding` and conditionally spreads `['## Compounding', '', body, '']` — identical idiom to Memory Health.
- `test/today-command.compounding.test.js`: end-to-end tests through `runToday` with the REAL briefing-renderer + trend engine (renders at 7 growing rows; suppressed at 0 rows).
- `test/today/briefing-renderer.test.js`: three unit tests for the renderer spread (renders with body, omits when null, omits when absent).

## Deviations

- **Test placement:** plan named `test/today-command.test.js` for the integration tests. They were moved to a dedicated `test/today-command.compounding.test.js` after diagnosing cross-suite jest mock-registry leakage: earlier suites' `doMock` registrations (some lacking `readDailyStats`) win over per-test `doMock`/`isolateModules` setups for requires that happen lazily inside `runToday` at call time. The dedicated file with hoisted `jest.mock` is deterministic. Net change to `today-command.test.js`: zero.

## Verification

- `npx jest test/today-command.test.js test/today-command.compounding.test.js test/today/briefing-renderer.test.js` — 74/74 pass.
- Full suite: 1278 passed, 5 skipped, 1 failed — the failure is `test/uat/uat-classification.test.js` (LLM-dependent UAT, CI-skipped), which fails identically on the base branch without these changes: pre-existing environmental, not a regression.

## Self-Check: PASSED
