---
phase: 20-value-extraction-instrumentation
plan: 05
subsystem: briefing
tags: [summary-line, briefing-renderer, briefing-helpers, daily-stats, tdd, pattern-12, d-05, d-06]

# Dependency graph
requires:
  - phase: 20-02
    provides: "readDailyStats() returning prior-day rows; dateKey() for timezone-safe date keys"
provides:
  - "src/briefing-helpers.js: buildYesterdaySummaryLine(priorRow, dayBeforePrior) — pure formatter"
  - "src/today/briefing-renderer.js: renderBriefing prepends Yesterday summary line at briefing top"
affects:
  - briefing output (top of /today briefing now carries 5-delta stats when a prior-day row exists)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pattern 12 lazy require: pipeline-infra, daily-stats, vault-gateway, briefing-helpers all required lazily inside renderBriefing try/catch — no cold-path cost"
    - "D-06 briefing-is-the-product: try/catch wraps entire summary-line block; any failure silently sets summaryLine=''"
    - "Largest-date-less-than-today rule for priorRow selection — handles history gaps gracefully"
    - "TDD RED→GREEN for both tasks"

key-files:
  modified:
    - src/briefing-helpers.js
    - src/today/briefing-renderer.js
    - test/briefing-helpers.test.js
    - test/today/briefing-renderer.test.js

key-decisions:
  - "buildYesterdaySummaryLine is a pure function in briefing-helpers.js — no I/O, no config reads; all I/O lives in renderBriefing's try/catch wrapper"
  - "Summary line placed at TOP of briefing string (before YAML frontmatter), separated by double newline — first thing user sees"
  - "Largest-date-less-than-today rule (not strict yesterday check) — chosen over exact yesterday match to handle history gaps gracefully"
  - "All lazy requires inside try/catch per Pattern 12 — zero cold-path cost when Voyage or stats are unavailable"
  - "jest.mock at file top + mockReturnValue per-test pattern — avoids jest.isolateModules/doMock hoisting issues with lazy requires"

# Metrics
duration: 28min
completed: 2026-04-25
---

# Phase 20 Plan 05: Yesterday Summary Line Render Summary

**Pure formatter `buildYesterdaySummaryLine` added to briefing-helpers.js; `renderBriefing` prepends verbatim 5-delta "Yesterday: ..." line at briefing top with silent suppression on all 4 degenerate paths — 48 tests passing**

## Performance

- **Duration:** ~28 min
- **Started:** 2026-04-25T16:01:34Z
- **Completed:** 2026-04-25T16:29:00Z
- **Tasks:** 2 (Task 1: pure formatter, Task 2: renderer integration)
- **Files modified:** 4

## Accomplishments

### Task 1: buildYesterdaySummaryLine pure formatter (briefing-helpers.js)

- Added `buildYesterdaySummaryLine(priorRow, dayBeforePrior)` to `src/briefing-helpers.js`
- Pure function — no I/O, no config reads, no logging; returns `''` on null/undefined priorRow
- Verbatim D-05 output: `"Yesterday: +N proposals, +M promotions, +X.X KB memory, +K entries, R recalls"`
- First 4 deltas always carry sign (`+0` is valid); 5th (recall_count) bare integer
- memory_kb delta to 1 decimal place with proper sign
- Falls back to priorRow values (signed `+`) when dayBeforePrior is null (day-2 case)
- 9 new tests covering all plan-specified cases; all pass
- TDD: RED commit (9b48299) → GREEN commit (9ce4c34)

### Task 2: Summary line wire-up in briefing-renderer.js (TODAY-SUMMARY-01)

- `renderBriefing` now builds the briefing `body` first, then computes the optional `summaryLine` prefix
- Lazy requires for `pipeline-infra`, `daily-stats`, `vault-gateway`, `briefing-helpers` all inside try/catch (Pattern 12)
- Largest-date-less-than-today rule for priorRow selection — handles stats history gaps
- 4 silent-suppression paths tested and working: missing file (empty rows), parse throw, day-1 (no prior row), summaryLineEnabled=false
- 7 new tests (plus existing 20 = 27 total in renderer suite); all pass
- Body content verified unchanged when summary line is prepended
- TDD: RED commit (9262419) → GREEN commit (d23d023)
- Test mock strategy: top-level `jest.mock` + per-test `mockReturnValue` — avoids `jest.isolateModules`/`doMock` hoisting issues with lazy requires inside functions

## Task Commits

| Task | Description | Commit |
|------|-------------|--------|
| 1 RED | Failing tests for buildYesterdaySummaryLine | 9b48299 |
| 1 GREEN | buildYesterdaySummaryLine pure formatter | 9ce4c34 |
| 2 RED | Failing tests for renderer summary-line prepend | 9262419 |
| 2 GREEN | renderBriefing summary-line prepend with silent suppression | d23d023 |

## Files Created/Modified

- `src/briefing-helpers.js` — Added `buildYesterdaySummaryLine` (53 lines including JSDoc) + export
- `src/today/briefing-renderer.js` — `renderBriefing` refactored: body assembled first, then optional summary prefix prepended; 45 lines added
- `test/briefing-helpers.test.js` — 9 new tests in `describe('buildYesterdaySummaryLine')`
- `test/today/briefing-renderer.test.js` — 7 new tests in `describe('Phase 20: yesterday summary line')` + top-level mock additions for pipeline-infra, daily-stats, vault-gateway

## Coverage

| File | Tests | Status |
|------|-------|--------|
| src/briefing-helpers.js | 21 total (9 new) | All pass |
| src/today/briefing-renderer.js | 27 total (7 new) | All pass |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] jest.mock hoisting prevents jest.doMock inside jest.isolateModules from affecting lazy requires**
- **Found during:** Task 2 GREEN verification
- **Issue:** `jest.isolateModules` + `jest.doMock` pattern cannot override lazy `require()` calls made inside function bodies at call time when a top-level `jest.mock` for the same module already exists in the file. The renderer's `require('../briefing-helpers')` inside `renderBriefing` uses the module registry snapshot at load time, not at call time.
- **Fix:** Switched to top-level `jest.mock` for all four dependencies (pipeline-infra, daily-stats, vault-gateway, briefing-helpers) + per-test `mockReturnValue`/`mockImplementation` pattern. This is the standard Jest pattern for controlling lazy-required module behavior without isolateModules.
- **Files modified:** `test/today/briefing-renderer.test.js`
- **Commit:** d23d023

**2. [Rule 3 - Blocking] Top-level briefing-helpers mock needed buildYesterdaySummaryLine added**
- **Found during:** Task 2 test restructuring
- **Issue:** The pre-existing top-level `jest.mock('../../src/briefing-helpers')` only exported `formatBriefingSection`. Adding `buildYesterdaySummaryLine: jest.fn(() => '')` to the factory was required for existing tests to not break when the renderer started calling it.
- **Fix:** Updated the top-level mock factory to include both exports; existing tests unaffected (the renderer returns early when summaryLine is '' so `formatBriefingSection` behavior unchanged).
- **Files modified:** `test/today/briefing-renderer.test.js`
- **Commit:** d23d023

## Known Stubs

None — all exports fully implemented. No TODO, FIXME, or stub patterns in modified files.

## Self-Check: PASSED

- `src/briefing-helpers.js` exists and exports `buildYesterdaySummaryLine` (grep confirmed)
- `src/today/briefing-renderer.js` contains `buildYesterdaySummaryLine`, `summaryLineEnabled`, `readDailyStats` (grep confirmed)
- Commit 9b48299 exists (Task 1 RED)
- Commit 9ce4c34 exists (Task 1 GREEN)
- Commit 9262419 exists (Task 2 RED)
- Commit d23d023 exists (Task 2 GREEN)
- 48 tests pass across both test files
- No stubs in modified files
- ESLint clean for modified files
- Verbatim D-05 wording confirmed in src/briefing-helpers.js and test output
- All 4 silent-suppression paths tested (missing file, throw, day-1, summaryLineEnabled=false)
- No top-level requires for lazy modules; `buildYesterdaySummaryLine` not in first 20 lines of renderer
