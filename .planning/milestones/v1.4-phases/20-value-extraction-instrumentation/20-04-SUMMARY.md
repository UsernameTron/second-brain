---
phase: 20-value-extraction-instrumentation
plan: 04
subsystem: instrumentation
tags: [today-command, daily-stats, recordStats, latency, briefing, telemetry]

requires:
  - phase: 20-value-extraction-instrumentation
    provides: 20-02 daily-stats core (recordDailyStats, dateKey, vault-gateway atomic writer); 20-03 counter helpers (readDailyCounters) + latency accumulator (_phase20.latencies)
provides:
  - recordStats orchestrator step in today-command after briefing-renderer
  - 7-field payload aggregation (proposals, promotions, totalEntries, memoryKb, recallCount, avgLatencyMs, avgConfidence)
  - dry-run mode skip (does NOT pollute daily-stats.md with practice runs)
  - briefing-is-the-product enforcement (D-06): every recordDailyStats failure swallowed silently, briefing always returned
  - 6-scenario end-to-end integration test for the orchestrator wiring
affects:
  - 21+ (consumers of daily-stats.md rows can rely on row presence after every non-dry-run /today)

tech-stack:
  added: []
  patterns:
    - "Pattern 15 (Phase 20): Orchestrator-step wrapping — recordStats runs AFTER user-facing artifact (briefing) is written. Every sub-fetch in its own try/catch with safe defaults (counters→zeros, memoryKb→0, totalEntries→0). Outer try/catch swallows recordDailyStats failures."
    - "Pattern 16 (Phase 20): dry-run suppression — the 'dry-run' mode is reserved for practice runs that should not pollute persistent state (daily-stats.md, counter files). recordStats wraps in `if (mode !== 'dry-run')`."

key-files:
  created:
    - test/integration/today-stats.test.js (6 SC scenarios)
  modified:
    - src/today-command.js (recordStats step after briefing-renderer; +42 lines)
    - test/today-command.test.js (Phase 20 recordStats tests; +263 lines)

key-decisions:
  - "recordStats runs AFTER briefing-renderer completes and the briefing file is written — briefing is the user-facing product, stats is downstream telemetry"
  - "Each input aggregation in its own try/catch so a single sub-fetch failure (e.g., readDailyCounters cache corruption) cannot prevent recordDailyStats from being called with safe defaults"
  - "memoryKb computed from fs.statSync(memoryPath).size / 1024 rounded to 1 decimal — matches D-02/PLAN-02 contract"
  - "totalEntries delegated to memory-reader.readMemory().length — single source of truth for memory entry count"
  - "dry-run mode skip is structural, not config-flag: `if (mode !== 'dry-run')` ensures practice runs cannot accidentally pollute"
  - "Integration test uses spy-based assertion on recordDailyStats (jest.fn()) rather than checking the file system — keeps test orthogonal to plan-02's vault-gateway/file-shape contract (already covered by daily-stats.test.js)"

patterns-established:
  - "Pattern 15: Orchestrator-step wrapping (post-product, isolated sub-fetches, silent outer catch)"
  - "Pattern 16: dry-run suppression at orchestrator step boundaries"

requirements-completed:
  - STATS-DAILY-01
  - STATS-LATENCY-01
  - STATS-GROWTH-01

duration: ~30min
completed: 2026-04-25
---

# Phase 20 Plan 04: recordStats Orchestrator Step Summary

**Wired recordDailyStats() invocation as a post-briefing orchestrator step in today-command — aggregates 7 fields from Phase 20-03 staging, runs only on non-dry-run modes, swallows all stats failures so briefing is the product**

## Performance

- **Duration:** ~30 min
- **Tasks:** 2
- **Files modified:** 3 (1 created, 2 modified)
- **Net diff:** +305 / -1 lines

## Accomplishments
- `recordDailyStats()` invocation site added to `runToday()` after briefing-renderer completes
- 7-field payload aggregation: counters (3 fields) from `readDailyCounters()`, `memoryKb` from `fs.statSync`, `totalEntries` from `memory-reader.readMemory().length`, `avgLatencyMs` from `_phase20.latencies`
- Each input sub-fetch wrapped in its own try/catch with safe defaults — a single failed input cannot prevent the recordDailyStats call
- Outer try/catch swallows recordDailyStats failures silently (D-06 briefing-is-the-product)
- `dry-run` mode skip prevents practice/test runs from polluting `daily-stats.md`
- 6-scenario integration test (test/integration/today-stats.test.js): first-run, same-day idempotent re-call, dry-run skip, briefing-is-the-product (record throws), missing memory.md, avgLatencyMs round-trip

## Task Commits
1. **Task 1: recordStats step + unit tests** — `1e6e74b` (feat)
2. **Task 2: end-to-end integration test** — `b77de8b` (test)

## Decisions Made
- **Spy-based integration test** — early integration-test attempt asserted file-system state directly; refactored to spy-based assertion on `recordDailyStats` because the file-shape contract is already covered by plan-02's `daily-stats.test.js`. The integration test now verifies the orchestrator wiring (call count, payload shape, dry-run skip, error swallowing) without coupling to vault-gateway internals.
- **Sub-fetch isolation** — each of the 3 input aggregations (counters, memoryKb, totalEntries) lives in its own try/catch so corruption in one source cannot cascade. Defaults are zeros, which produce a valid (if uninteresting) row rather than a missing one.

## Deviations from Plan
None — plan executed as specified.

## Issues Encountered
- **Test re-architecture mid-task** (resolved): initial integration test asserted on `fs.existsSync(daily-stats.md)`, which failed because the test mocks `daily-stats` module entirely. Refactored to spy-based assertion. Final 6 tests cover all SC scenarios from the plan.

## Next Phase Readiness
- recordStats step is the canonical write path for Phase 20 telemetry. Plan 20-05's summary-line render reads from the rows this step produces.
- All 4 Phase 20 source-code plans (20-02 core, 20-03 emit, 20-04 orchestrator, 20-05 render) wired together.

---
*Phase: 20-value-extraction-instrumentation*
*Completed: 2026-04-25*
