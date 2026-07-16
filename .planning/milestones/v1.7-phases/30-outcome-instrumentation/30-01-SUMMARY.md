---
phase: 30-outcome-instrumentation
plan: 01
subsystem: infra
tags: [daily-stats, jest, gray-matter, vault-gateway]

# Dependency graph
requires:
  - phase: 29-series-integrity
    provides: jest-safe counter cache isolation (CACHE_DIR_OVERRIDE), flushMissedDays 14-day cleanup
provides:
  - recordEchoShown export and hit-aware recordRecallInvocation on src/daily-stats.js
  - 11-column daily-stats schema (recall_hits, echo_shown, echo_score)
  - numeric coercion at the readDailyStats root (Number for numeric cells, '—' and '' stay strings)
affects: [30-02-outcome-wiring, 31-trend-computation]

# Tech tracking
tech-stack:
  added: []
  patterns: ["record* counter clone pattern (try/catch, never throw)", "root-level Number.isFinite coercion instead of per-consumer coercion"]

key-files:
  created: []
  modified: [src/daily-stats.js, test/daily-stats.test.js]

key-decisions:
  - "resultCount from recordRecallInvocation opts is accepted but not persisted (no per-query result-count column this phase) — matches plan's explicit non-goal"
  - "recordEchoShown overwrites (not accumulates) echoShown/echoScore — one /today run per day is the norm, mirrors last-run-wins semantics elsewhere in the module"
  - "Numeric coercion applied once at readDailyStats root rather than in every consumer (memory-health's _num() and briefing-helpers' arithmetic already tolerate both strings and numbers, so centralizing here is strictly additive)"

patterns-established:
  - "New counter fields follow _COUNTER_DEFAULTS → readDailyCounters → catch-fallback triad to keep shape consistent on any read path"

requirements-completed: [STATS-OUTCOME-01, STATS-OUTCOME-02]

# Metrics
duration: 25min
completed: 2026-07-16
---

# Phase 30 Plan 01: Outcome Instrumentation Data Layer Summary

**Extended src/daily-stats.js with a recall-hit counter, Memory Echo outcome counter, 11-column schema, and root-level numeric coercion in readDailyStats — the interface Plan 02 wires /recall and /today into.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-16T07:20:00Z
- **Completed:** 2026-07-16T07:32:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `recordRecallInvocation` now increments `recallHits` only when `opts.hit` is truthy (recallCount always increments)
- New `recordEchoShown(shown, score, opts)` export persists `echoShown` (0|1) and `echoScore` to the daily counter file
- `readDailyCounters` (and its catch-block fallback) surface `recallHits`, `echoShown`, `echoScore` alongside existing fields
- `COLUMNS` grew from 8 to 11 entries (`recall_hits`, `echo_shown`, `echo_score`), with `recordDailyStats` and `flushMissedDays` writing/carrying the new cells
- `readDailyStats` coerces numeric table cells to `Number` at the root; the em dash `—` and empty string survive as strings — verified by round-trip tests plus a `recall_hits <= recall_count` invariant check

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend counter store — recallHits, echoShown, echoScore, recordEchoShown, hit-aware recordRecallInvocation** - `40040a3` (feat)
2. **Task 2: 11-column schema + numeric coercion in readDailyStats with round-trip test** - `e941f96` (feat)

_Both tasks were tdd="true": tests were written and confirmed RED before the corresponding implementation, then confirmed GREEN — no separate refactor commit was needed._

## Files Created/Modified
- `src/daily-stats.js` - recallHits/echoShown/echoScore counter fields, recordEchoShown export, hit-aware recordRecallInvocation, 11-entry COLUMNS, recordDailyStats/flushMissedDays new-cell wiring, Number.isFinite coercion in readDailyStats
- `test/daily-stats.test.js` - 8 new tests (6 in Task 1 for hit/miss + echo persistence + counters shape, 2 in Task 2 for 11-column coercion round-trip and em-dash fallback), plus 6 existing row assertions updated from string to Number literals and one expected-header string updated to 11 columns

## Decisions Made
- `resultCount` is accepted in `recordRecallInvocation`'s opts contract (for Plan 02's caller) but intentionally not persisted anywhere — no column or counter field added for it, per the plan's explicit non-goal.
- `recordEchoShown` overwrites rather than accumulates, matching the "one `/today` run per day" reality and the existing last-run-wins pattern in `recordDailyStats`.
- Numeric coercion lives once at the `readDailyStats` root instead of being duplicated in each consumer; confirmed non-breaking against `memory-health.js`'s `_num()` (already does `Number(val)`) and `briefing-helpers.js`'s `buildYesterdaySummaryLine` (arithmetic operators already coerced strings implicitly).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Initial test runs were executed from the wrong working directory (main repo checkout instead of this worktree), producing false "all passing" results because the file being edited and the file being tested were different checkouts. Corrected by running jest from within the worktree with `--testPathIgnorePatterns="/node_modules/"` (the repo's default jest config ignores `.claude/worktrees`, which this working directory is nested under — a known gotcha recorded in STATE.md from a prior session).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 02 can now call `recordRecallInvocation({ hit, resultCount, now })` and `recordEchoShown(shown, score, opts)` from `/recall` and `/today` respectively, and rely on `readDailyStats` returning numeric cells.
- Full repo test suite green post-merge: 1220 passed, 38 skipped, 0 failed (60/64 suites; 4 UAT suites skipped by CI guard).

---
*Phase: 30-outcome-instrumentation*
*Completed: 2026-07-16*

## Self-Check: PASSED

- FOUND: src/daily-stats.js
- FOUND: test/daily-stats.test.js
- FOUND: .planning/phases/30-outcome-instrumentation/30-01-SUMMARY.md
- FOUND: commit 40040a3 (Task 1)
- FOUND: commit e941f96 (Task 2)
