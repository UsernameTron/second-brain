---
phase: 20-value-extraction-instrumentation
plan: 03
subsystem: instrumentation
tags: [telemetry, daily-stats, recall, promote-memories, semantic-index, today-command, latency]

requires:
  - phase: 20-value-extraction-instrumentation
    provides: src/daily-stats.js core module (recordDailyStats, dateKey, readDailyStats) + vaultWriteAtomic
provides:
  - 6 new daily-stats counter helpers (recordRecallInvocation, recordProposalsBatch, recordPromotion, recordTopCosine, recordTopRrf, readDailyCounters)
  - recall_count emit at runRecall() entry point (D-04 enforced — Memory Echo path uses internal searchers, not runRecall)
  - top-1 RRF emit in --hybrid branch
  - proposals + promotions + avg_confidence emit in promote-memories.js
  - top-1 cosine emit in semantic-index.js (D-07 emit-only)
  - latency timing harness in today-command.js (per-connector + per-operation Date.now wrappers, _phase20.latencies accumulator, mean → avgLatencyMs)
affects:
  - 20-04 (recordStats orchestrator step reads readDailyCounters() + _phase20.latencies)
  - 20-05 (summary-line render reads prior-day row from daily-stats.md)
  - 21+ (top-1 cosine + RRF telemetry sinks consumed by future surface)

tech-stack:
  added: []
  patterns:
    - "Pattern 12 (Phase 20): Cross-process counter staging via ~/.cache/second-brain/daily-counters-{dateKey}.json — atomic .tmp+rename writes, never throws, last-known value on read failure"
    - "Pattern 13 (Phase 20): Telemetry emit isolation — every emit call try/catch-wrapped at the call site (D-06 briefing-is-the-product)"
    - "Pattern 14 (Phase 20): Latency accumulator via shared object on briefing context (_phase20.latencies); each timed operation pushes { name, ms } and downstream code computes mean"

key-files:
  created:
    - test/recall-command.test.js (Phase 20 instrumentation tests)
    - test/semantic-index.test.js (Phase 20 top-1 cosine emit tests)
    - test/today-command.test.js (Phase 20 latency harness tests)
  modified:
    - src/daily-stats.js (+6 helpers, ~150 lines)
    - src/recall-command.js (recall_count + RRF top-1 emit)
    - src/promote-memories.js (proposals/promotions/avg_confidence emit)
    - src/semantic-index.js (top-1 cosine emit, D-07 emit-only)
    - src/today-command.js (latency timing harness around connectors + operations)
    - test/daily-stats.test.js (counter-helpers describe block, +137 lines)
    - test/promote-memories.test.js (Phase 20 instrumentation tests)

key-decisions:
  - "D-04 enforced via call-site separation: runRecall() increments recall_count; getMemoryEcho() (Memory Echo path) uses searchers directly without going through runRecall"
  - "D-07 enforced: top-1 cosine + RRF emit only — no consumer added in Phase 20, sinks reserved for future surface"
  - "D-09 enforced: counters stage to ~/.cache/second-brain/daily-counters-{dateKey}.json (separate from daily-stats.md). today-command flushes via recordDailyStats() in plan 20-04"
  - "Each emit call try/catch-wrapped at the call site (D-06): a counter-store write failure cannot break /recall, /promote-memories, or /today"

patterns-established:
  - "Pattern 12: Cross-process counter staging file (atomic, never-throws, last-known-value)"
  - "Pattern 13: Telemetry emit isolation (try/catch at every emit call site)"
  - "Pattern 14: Latency accumulator on briefing context"

requirements-completed:
  - STATS-DAILY-01
  - STATS-LATENCY-01

duration: ~25min
completed: 2026-04-25
---

# Phase 20 Plan 03: Counter Emit Points Summary

**Wired 5 telemetry emit points across recall-command, promote-memories, semantic-index, and today-command — staging counters to a cross-process JSON file and per-call telemetry sinks for top-1 cosine + RRF**

## Performance

- **Duration:** ~25 min
- **Tasks:** 4
- **Files modified:** 8 (3 created, 5 modified)
- **Net diff:** +788 / -9 lines

## Accomplishments
- 6 new daily-stats helpers that never throw (`recordRecallInvocation`, `recordProposalsBatch`, `recordPromotion`, `recordTopCosine`, `recordTopRrf`, `readDailyCounters`)
- recall_count increment at the user-facing `/recall` entry point only (Memory Echo path bypasses it per D-04)
- proposals + promotions + avg_confidence aggregator wired into the promote-memories flow
- Top-1 cosine emit in semantic-index after threshold-filtered results (zero results → no emit per D-07)
- Top-1 RRF emit in recall-command's --hybrid branch after fusion completes
- Latency timing harness in today-command — per-connector (calendar, gmail, github), per-operation (semanticSearch, getMemoryEcho), aggregated mean → `avgLatencyMs`

## Task Commits

1. **Task 1: Counter helpers in daily-stats.js** — `cd1dd8b` (feat)
2. **Task 2: recall_count + RRF top-1 emit** — `055d6b0` (feat)
3. **Task 3: proposals + promotions + avg_confidence emit** — `4165d72` (feat)
4. **Task 4: top-1 cosine + latency timing harness** — `4511bc4` (feat)

## Decisions Made
- **Cross-process counter store** (`~/.cache/second-brain/daily-counters-{dateKey}.json`): kept separate from daily-stats.md because /recall and /promote-memories run as standalone process invocations independent of /today. Atomic .tmp+rename ensures consistency; never-throws contract ensures telemetry failures cannot break user-facing flows.
- **Memory Echo path bypass**: D-04 enforced structurally — `getMemoryEcho()` uses internal `searchMemoryKeyword` / `searchMemorySemantic` helpers without calling `runRecall()`, so the increment naturally fires only on top-level `/recall` invocations.
- **Latency accumulator on shared context**: `_phase20.latencies` array attached to the briefing-render context lets timing wrappers push `{ name, ms }` records and the downstream `recordDailyStats` call (plan 20-04) computes the mean. Avoids global state and works cleanly with try/catch isolation.

## Deviations from Plan
None — plan executed as specified.

## Issues Encountered
- **Pre-existing failures observed in full suite (NOT caused by plan 20-03):**
  - `test/integration/semantic-search.test.js` Scenario 6 — 2 failing assertions for missing `VOYAGE_API_KEY` flow (verified pre-existing by reverting plan 20-03 source files; failures persist on the c574a83 baseline).
  - `test/uat/uat-classification.test.js` UAT-01 — classifier accuracy <80% threshold (pre-existing, classifier-tuning concern).
- All 4 plan-20-03 test additions pass GREEN; no regressions introduced.

## Next Phase Readiness
- `readDailyCounters()` ready for plan 20-04's `recordStats` orchestrator step.
- `_phase20.latencies` accumulator wiring ready for plan 20-04 to compute `avgLatencyMs`.
- Top-1 cosine + RRF sinks emit-only — no consumer in Phase 20, deferred per D-07.

---
*Phase: 20-value-extraction-instrumentation*
*Completed: 2026-04-25*
