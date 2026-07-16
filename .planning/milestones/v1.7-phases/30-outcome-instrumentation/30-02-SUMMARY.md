---
phase: 30-outcome-instrumentation
plan: 02
subsystem: infra
tags: [recall-command, today-command, daily-stats, jest]

# Dependency graph
requires:
  - phase: 30-outcome-instrumentation
    plan: 01
    provides: recordEchoShown export and hit-aware recordRecallInvocation on src/daily-stats.js, 11-column schema
provides:
  - /recall records hit/miss + resultCount after results are known (STATS-OUTCOME-01)
  - /today records Memory Echo shown/score and flows recallHits/echoShown/echoScore into the daily-stats row (STATS-OUTCOME-02)
affects: [30-03-live-verification]

# Tech tracking
tech-stack:
  added: []
  patterns: ["move counter-recording calls to AFTER the outcome is known so hit/miss can be captured in the same call"]

key-files:
  created: []
  modified: [src/recall-command.js, src/today-command.js, test/recall-command.test.js, test/today-command.test.js]

key-decisions:
  - "recordRecallInvocation moved from the top of runRecall (before search dispatch) to immediately after topN/blocked are computed — a crashed search (hits=[] from the catch block) now still records a non-hit invocation instead of no invocation at all"
  - "recordEchoShown call is guarded by mode !== 'dry-run', matching the existing dry-run guard around the whole stats block, so practice runs never write echo counters"
  - "No query text is passed to recordRecallInvocation or recordEchoShown — verified by grep across both files"

patterns-established:
  - "record*-after-outcome: counter calls that need pass/fail context are placed after the result is fully known, not at invocation start"

requirements-completed: [STATS-OUTCOME-01, STATS-OUTCOME-02]

# Metrics
duration: 20min
completed: 2026-07-16
---

# Phase 30 Plan 02: Outcome Instrumentation Command Wiring Summary

**Wired /recall and /today to the Plan 01 daily-stats contracts — /recall now records hit/miss + resultCount after search results are known, and /today records Memory Echo shown/score plus flows recallHits/echoShown/echoScore into the 11-column daily-stats row.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-07-16T07:35:00Z
- **Completed:** 2026-07-16T07:55:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `runRecall` no longer records the recall-count counter before dispatching the search; the call moved to right after `topN`/`empty`/`blocked` are computed, passing `{ hit: topN.length > 0 && !blocked, resultCount: topN.length }`
- A crashed search (caught by the outer try/catch, `hits = []`) now still records a non-hit invocation instead of silently skipping the counter
- `/today` calls `recordEchoShown(memoryEcho.entries.length > 0, memoryEcho.score)` right after `getMemoryEcho`, gated on `mode !== 'dry-run'`
- The non-dry-run stats block's `counters` default and `recordDailyStats` payload both carry `recallHits`, `echoShown`, `echoScore` sourced from `readDailyCounters()`
- No query text reaches any stats function — confirmed by `grep -n "query"` across both modified source files

## Task Commits

Each task was committed atomically:

1. **Task 1: /recall records hit/miss after results are known** - `804db0d` (feat)
2. **Task 2: /today records Memory Echo outcome and writes the 11-column row** - `d2b2561` (feat)

## Files Created/Modified
- `src/recall-command.js` - moved `recordRecallInvocation` call from pre-search to post-result, now passes `{ hit, resultCount }`
- `test/recall-command.test.js` - 3 new tests (hit with resultCount, blocked recall records hit:false, empty result records hit:false); existing Times-based assertions unaffected by the new call signature
- `src/today-command.js` - `recordEchoShown` call after `getMemoryEcho` (dry-run guarded), `counters` default + `recordDailyStats` payload extended with `recallHits`/`echoShown`/`echoScore`
- `test/today-command.test.js` - `setupRecordStatsMocks` extended with `recordEchoShown`/`flushMissedDays` mocks and richer `readDailyCounters` default fixture; 2 new tests (non-dry-run echo call + pass-through, dry-run skips echo call)

## Decisions Made
- Placed the `recordRecallInvocation` call after the whole search try/catch (not inside the try block) so it observes `topN`/`blocked` in their final state, including the crashed-search path.
- Kept `recordEchoShown` outside the later `mode !== 'dry-run'` stats-aggregation block (it's called right after Memory Echo runs, before slippage/synthesis/render) but duplicated the same dry-run guard locally, since Memory Echo itself runs in every mode and only the counter WRITE should be suppressed for dry-run.
- Added `flushMissedDays: jest.fn()` to the `setupRecordStatsMocks` daily-stats mock per the plan's note — prevents the pre-existing silent-catch around the Phase 29 `flushMissedDays()` call from masking a missing mock in future tests.

## Deviations from Plan

None - plan executed exactly as written. (Task 2's action text also matched the pre-merged Phase 29 `flushMissedDays` wiring already present in the file at plan-write time.)

## Issues Encountered
- This worktree's branch (`worktree-agent-a44911290b3834d05`) had been created before Phase 29 and Plan 30-01 were merged into `chore/v1.7-milestone-init`, so the initial checkout was missing `src/daily-stats.js`'s `recordEchoShown`/hit-aware `recordRecallInvocation` exports and the phase 30 plan/summary files entirely. Resolved with `git merge --ff-only chore/v1.7-milestone-init` (the branch had zero unique commits, so the fast-forward was clean) before starting Task 1.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 03's blocking human-verify checkpoint (a real `/today` run producing an 11-column row against the live vault) can now proceed — both commands are wired end-to-end.
- Full repo test suite green: 60/64 suites passed (4 UAT suites skipped by CI guard), 1225 passed, 38 skipped, 0 failed.

---
*Phase: 30-outcome-instrumentation*
*Completed: 2026-07-16*

## Self-Check: PASSED

- FOUND: src/recall-command.js
- FOUND: src/today-command.js
- FOUND: test/recall-command.test.js
- FOUND: test/today-command.test.js
- FOUND: commit 804db0d (Task 1)
- FOUND: commit d2b2561 (Task 2)
