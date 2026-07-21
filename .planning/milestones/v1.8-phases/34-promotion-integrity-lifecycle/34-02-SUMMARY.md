---
phase: 34-promotion-integrity-lifecycle
plan: 02
subsystem: memory
tags: [memory-reader, minisearch, recall, superseded, stale]

# Dependency graph
requires: []
provides:
  - readMemory() surfaces entry.supersededBy / entry.stale (default null)
  - searchMemoryKeyword and getMemoryEcho downrank (never filter) superseded/stale entries by DOWNRANK_FACTOR (0.4)
affects: [34-promotion-integrity-lifecycle dream-consolidation MERGE/STALE ops, promotion contradiction-check work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Read-time downrank via score multiplier, never a filter — provenance stays queryable, live entries win ties"

key-files:
  created: []
  modified:
    - src/memory-reader.js
    - test/unit/memory-reader.test.js

key-decisions:
  - "DOWNRANK_FACTOR = 0.4 applied as a straight score multiplier in both searchMemoryKeyword and getMemoryEcho, single shared constant"
  - "Downrank happens after scoring, before sort/threshold — entries can drop below the echo threshold as a side effect but are never pre-filtered out"

patterns-established:
  - "superseded-by:: / stale:: inline fields parsed by the existing _parseFields generic key:: value collector — no new parsing path needed"

requirements-completed: [SUPERSEDED-CONVENTION-01]

# Metrics
duration: 20min
completed: 2026-07-20
---

# Phase 34 Plan 02: Superseded/Stale Downrank Summary

**readMemory surfaces `superseded-by::`/`stale::` fields; keyword search and Memory Echo apply a 0.4x score multiplier so those entries rank below live equals without ever being filtered out.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2/2 completed
- **Files modified:** 2

## Accomplishments
- `entry.supersededBy` and `entry.stale` now surfaced on every `readMemory()` entry (default `null`), sourced from the existing generic `_parseFields` collector — no new parsing logic needed
- `searchMemoryKeyword` and `getMemoryEcho` both apply a single `DOWNRANK_FACTOR = 0.4` score multiplier when either field is set, before their respective sort/threshold steps
- Superseded/stale entries remain fully present in results (never filtered) — verified with dedicated tests asserting both entries are returned and ordering is strict

## Task Commits

1. **Task 1: Surface superseded-by/stale on readMemory entries** - `befda17` (feat)
2. **Task 2: Downrank superseded/stale entries in keyword search and Memory Echo** - `8b26999` (feat)

## Files Created/Modified
- `src/memory-reader.js` - readMemory pushes `supersededBy`/`stale`; `DOWNRANK_FACTOR` constant; `searchMemoryKeyword` storeFields extended + score multiplier applied before sort; `getMemoryEcho` score multiplier applied before threshold filter/sort
- `test/unit/memory-reader.test.js` - R7-R9 (field surfacing incl. absent-fields-are-null), S10-S12 (keyword downrank ordering + presence + no-regression), E7 (echo downrank ordering + presence)

## Decisions Made
- Single `DOWNRANK_FACTOR` constant shared by both call sites rather than two magic numbers — matches the plan's "single downrank penalty constant" instruction.
- Used isolated scratch-vault fixtures per downrank test (temp `VAULT_ROOT` + temp `memory.md`) rather than editing the shared `memory-sample.md` fixture, to avoid perturbing the existing R1 "exactly 5 entries" assertion and other fixture-dependent tests.

## Deviations from Plan

**1. [Rule 3 - Blocking] Test file path differs from plan text**
- **Found during:** Task 1 read_first
- **Issue:** Plan references `test/memory-reader.test.js`; the actual file lives at `test/unit/memory-reader.test.js` (repo already organizes unit tests under `test/unit/`). No file exists at the plan's literal path.
- **Fix:** Added tests to the actual existing file at `test/unit/memory-reader.test.js`.
- **Files modified:** test/unit/memory-reader.test.js
- **Verification:** `npx jest test/unit/memory-reader.test.js` — 29/29 passing
- **Committed in:** befda17, 8b26999

**2. [Rule 3 - Blocking] jest config ignores the worktree path**
- **Found during:** Task 1 verify step
- **Issue:** `package.json` jest config has `testPathIgnorePatterns: [".claude/worktrees"]`; this executor runs inside a `.claude/worktrees/...` checkout, so plain `npx jest test/...` silently matched 0 tests.
- **Fix:** Ran tests with `npx jest test/unit/memory-reader.test.js --testPathIgnorePatterns='/node_modules/'` (CLI override) for verification only — no config file changed.
- **Files modified:** none (test-invocation workaround only)
- **Verification:** 29/29 tests passing under the override
- **Committed in:** n/a (no file change)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking, environment/path mismatches, no scope creep)
**Impact on plan:** No production behavior change from either deviation; both were required to execute the plan's own verify step at all.

## Issues Encountered
- `npm run eval:recall` (named in the plan's Task 2 acceptance criteria) requires `VOYAGE_API_KEY`, which is not set in this environment. Not run. Per the plan's own constraint, the seed vault has no superseded/stale entries so this change cannot affect recall@5 — the code path is additive (multiplier only applies when a field is present) and `npx jest test/unit/memory-reader.test.js` + `npm run lint` are both green as the available substitute verification.

## Next Phase Readiness
- The downrank convention on the read path is live and ready as the target for dream-consolidation's MERGE (`superseded-by::`) and STALE (`stale::`) write-side ops, and for the promotion-gate contradiction-check work in this same phase.
- No blockers.

---
*Phase: 34-promotion-integrity-lifecycle*
*Completed: 2026-07-20*

## Self-Check: PASSED
