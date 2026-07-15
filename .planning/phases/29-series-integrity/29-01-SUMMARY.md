---
phase: 29-series-integrity
plan: 01
subsystem: instrumentation
tags: [daily-stats, jest, cache, counters, today-command]

# Dependency graph
requires:
  - phase: 20-value-extraction-instrumentation
    provides: recordDailyStats()/readDailyStats() row store, per-day counter cache in ~/.cache/second-brain
provides:
  - JEST_WORKER_ID-guarded counter cache path (jest writes never touch the real user cache)
  - flushMissedDays() — idempotent recovery of orphan past-day counter files into daily-stats.md rows
  - _cleanupOldCounters() — 14-day retention pruning of counter files
  - flushMissedDays wired into the non-dry-run /today stats block
affects: [30-retrieval-utility, 31-trend-computation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "_cacheDir() precedence helper: CACHE_DIR_OVERRIDE > JEST_WORKER_ID temp dir > ~/.cache/second-brain"
    - "Noon-UTC (T12:00:00.000Z) date reconstruction to force a specific America/Chicago calendar day regardless of DST"

key-files:
  created: []
  modified:
    - src/daily-stats.js
    - test/daily-stats.test.js
    - src/today-command.js

key-decisions:
  - "Guarded _counterPath() on JEST_WORKER_ID instead of requiring every test file to set CACHE_DIR_OVERRIDE — one shared fix covers all current and future callers"
  - "flushMissedDays() reuses recordDailyStats' existing same-date dedupe for idempotency rather than tracking flushed-state separately"
  - "Deleted exactly the 5 named jest-polluted counter files (Pete-approved 2026-07-15) — no wildcard cache cleanup"

patterns-established:
  - "Non-fatal try/catch wrapping for all stats-adjacent /today calls (briefing-is-the-product)"

requirements-completed: [STATS-PIPE-01, STATS-PIPE-02]

# Metrics
duration: 35min
completed: 2026-07-15
---

# Phase 29 Plan 01: Series Integrity Summary

**JEST_WORKER_ID-guarded counter cache plus flushMissedDays() idempotent recovery, closing both the jest-pollution bug and the vault-unreachable orphan-day gap in one pass.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-07-15T23:24:31Z
- **Completed:** 2026-07-15T23:59:00Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- `_cacheDir()` resolves CACHE_DIR_OVERRIDE > JEST_WORKER_ID temp dir > `~/.cache/second-brain`, so any test calling `record*()` without an explicit override can no longer pollute the real cache
- Deleted the 5 pre-existing jest-contaminated counter files (2026-04-25/26/27, 2026-07-12, 2026-07-15) from `~/.cache/second-brain/`
- `flushMissedDays()` reconstructs one idempotent daily-stats row per orphan past-day counter file (avg_latency_ms renders as em-dash, skips today/future dates)
- `_cleanupOldCounters()` prunes counter files older than ~14 days after every flush
- Wired `flushMissedDays` into the non-dry-run `/today` stats block, running before `recordDailyStats`, isolated in its own try/catch

## Task Commits

Each task was committed atomically:

1. **Task 1: JEST_WORKER_ID counter-path guard, delete 5 polluted files, regression tripwire** - `3c4ec71` (fix)
2. **Task 2: flushMissedDays() + 14-day counter cleanup with tests** - `9e79bd0` (feat)
3. **Task 3: Wire flushMissedDays into the non-dry-run /today stats block** - `32eabb4` (feat)

## Files Created/Modified
- `src/daily-stats.js` - `_cacheDir()` guard, `flushMissedDays()`, `_cleanupOldCounters()`, updated exports
- `test/daily-stats.test.js` - regression tripwire (jest pollution) + 4 flushMissedDays tests (orphan flush, idempotent, skip-today, cleanup retention)
- `src/today-command.js` - imports and calls `flushMissedDays({ totalEntries, memoryKb })` before `recordDailyStats`

## Decisions Made
- Guarded `_counterPath()` centrally on `JEST_WORKER_ID` rather than auditing every test file for a missing `CACHE_DIR_OVERRIDE` — root-cause fix at the shared function, not per-caller patching
- `flushMissedDays()` forces a noon-UTC (`T12:00:00.000Z`) Date when replaying an orphan day, since noon UTC maps to the same America/Chicago calendar day year-round regardless of DST
- Reused `recordDailyStats`'s existing same-date-replace logic for idempotency instead of introducing a separate "already flushed" marker

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- This worktree's `package.json` jest config excludes any path containing `.claude/worktrees` via `testPathIgnorePatterns`, so the plan's literal verify commands (`CI=true npx jest ...`) return "0 matches" when run from inside this checkout. Worked around with the project's established pattern: append `--testPathIgnorePatterns='/node_modules/'` to override for this invocation only (documented precedent in phases 25/27/28 summaries). No repo config was changed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `src/daily-stats.js` counter store is test-proof and self-healing; ready for phase 30 (retrieval-utility columns) to build on the same counter/flush substrate without inheriting the pollution bug
- Full suite verified green: `CI=true npx jest --coverage --testPathIgnorePatterns='/node_modules/'` → 1212 passed, 38 skipped, 0 failed; `daily-stats.js` at 96.02% stmts / 90.6% branch / 100% funcs / 98.69% lines
- No blockers

---
*Phase: 29-series-integrity*
*Completed: 2026-07-15*
