---
phase: 34-promotion-integrity-lifecycle
plan: 04
subsystem: memory
tags: [contradiction-check, promote-memories, semantic-index, haiku, hybrid-search]

# Dependency graph
requires:
  - phase: 34-01
    provides: shared parseCheckboxState in src/memory-proposals.js; promote-memories.js near-miss abort + root-agreement assert
provides:
  - "src/contradiction-check.js: checkContradiction(entry, options) shared, never-throws helper"
  - "flag-only contradiction surfacing wired into promote-memories.js promotion loop"
affects: [34-05-dream-consolidation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "flag-only side-effect during a promotion loop: run after the unconditional write, swallow failures, attach an optional field to the result object only when non-empty (mirrors existing reach/indexRebuild pattern)"

key-files:
  created:
    - src/contradiction-check.js
    - test/contradiction-check.test.js
  modified:
    - src/promote-memories.js
    - test/promote-memories.test.js

key-decisions:
  - "checkContradiction matches its own entry out of hybridSearch results by comparing result.id (memory entry content hash, per memory-reader.js) against entry.contentHash — no new ID scheme needed"
  - "Default-mocked src/contradiction-check in promote-memories.test.js's top-of-file jest.mock so the ~65 unrelated tests in that suite never issue a real hybridSearch/Haiku call per promoted candidate; tests that exercise CONTRADICT-CHECK-01 re-mock after jest.resetModules()"
  - "No new pipeline.json config field added — checkContradiction already degrades to no-contradiction on any failure (missing config, no Voyage key, LLM init failure), so there was nothing further to gate behind config"

patterns-established:
  - "Shared flag-only detector module with a fixed NO_CONTRADICTION sentinel return, wrapped in one try/catch at the function boundary — the pattern src/dream.js should reuse verbatim rather than reimplementing"

requirements-completed: [CONTRADICT-CHECK-01]

# Metrics
duration: ~35min
completed: 2026-07-20
---

# Phase 34 Plan 04: Contradiction Check at Promotion Summary

**Shared `checkContradiction()` helper (hybrid top-5 + Haiku confirm) flags likely contradictions in the promotion result without ever blocking, editing, or gating the append — ready for dream STALE detection to call in Wave 3.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- `src/contradiction-check.js` exports `checkContradiction(entry, options)`: hybrid-searches the top 5 nearest memory entries (excluding the candidate's own hash), asks Haiku for a strict-JSON contradiction verdict, and never throws — any search/LLM/parse failure degrades to `{contradicts:false, against:null, confidence:0}`.
- `promote-memories.js` calls `checkContradiction` for each promoted candidate after `appendToMemoryFile` has already run; a `contradicts:true` result adds an entry to `result.contradictions` and emits a `CONTRADICTION_FLAG` diagnostic — the append itself is never conditional on the outcome.
- Fixed a real timeout regression the wiring introduced: the bulk of `promote-memories.test.js` didn't mock the new module, so 10-candidate batch tests were making real `hybridSearch`/Haiku attempts per promotion. Added a file-level default mock (`contradicts:false`) so unrelated tests stay fast and network-free, with the 3 new CONTRADICT-CHECK-01 tests overriding it per-test.

## Task Commits

1. **Task 1: checkContradiction shared helper** - `4646e75` (feat)
2. **Task 2: Flag-only contradiction surfacing at promotion** - `5d8c135` (feat)

_No separate TDD RED/GREEN commits — tests were written alongside the implementation and verified green before each task commit, consistent with the rest of this plan's tasks being `tdd="true"` in spirit but committed as one unit per the existing repo convention of test+implementation together._

## Files Created/Modified
- `src/contradiction-check.js` - `checkContradiction(entry, options)`: hybridSearch top-5, Haiku confirm, never-throws
- `test/contradiction-check.test.js` - 5 tests: contradiction detected, no contradiction, Haiku unavailable, empty hybridSearch results, hybridSearch throws
- `src/promote-memories.js` - per-candidate `checkContradiction` call in the promotion loop; `result.contradictions` field
- `test/promote-memories.test.js` - top-of-file default mock for `contradiction-check`; 3 new tests for flag-present-still-promoted, no-flag, and throws-still-promoted

## Decisions Made
- Matched candidates to their own hybridSearch hit via `result.id === entry.contentHash` — `memory-reader.js:166` already uses `contentHash` as the entry `id`, so no new correlation field was needed.
- Skipped adding a `pipeline.json` config flag to gate the check. The plan's "config-safe default" constraint is already satisfied structurally: `checkContradiction` has no config dependency of its own and never throws regardless of config state.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Default-mocked contradiction-check in promote-memories.test.js to prevent real network calls / timeouts**
- **Found during:** Task 2 verification (`npx jest test/promote-memories.test.js`)
- **Issue:** Wiring `checkContradiction` unconditionally into the promotion loop meant every existing test that promotes candidates without mocking `contradiction-check` now attempted real `hybridSearch` (keyword + Voyage) and Haiku calls per candidate. The 10-candidate "hard cap" test exceeded Jest's 5000ms default timeout.
- **Fix:** Added a top-of-file `jest.mock('../src/contradiction-check', ...)` returning `{contradicts:false}` by default in `promote-memories.test.js`, so the ~65 tests unrelated to CONTRADICT-CHECK-01 stay isolated and fast. The 3 new tests re-mock the module after `jest.resetModules()` to exercise real behavior paths.
- **Files modified:** test/promote-memories.test.js
- **Verification:** `npx jest test/promote-memories.test.js test/contradiction-check.test.js` — 69/69 passing, 1.3s (down from a timeout failure)
- **Committed in:** `5d8c135` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix — test isolation regression caused by my own wiring change)
**Impact on plan:** Necessary for correctness of the test suite; no scope creep into unrelated code.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None - no external service configuration required. `checkContradiction` reuses the existing Voyage/Anthropic credentials already configured for `hybridSearch`/`createHaikuClient`; missing credentials degrade to no-flag by design.

## Next Phase Readiness
- `checkContradiction` is a clean, dependency-free export (`src/contradiction-check.js`) with no promote-memories-specific coupling — Wave 3's `src/dream.js` STALE detection can `require('./contradiction-check')` directly.
- Full repo test suite (`npm test`) green: 1379 passed, 29 skipped. `npm run lint`: 0 errors (9 pre-existing `jest/expect-expect` warnings unrelated to this plan).

---
*Phase: 34-promotion-integrity-lifecycle*
*Completed: 2026-07-20*

## Self-Check: PASSED
All claimed files found; both task commit hashes (4646e75, 5d8c135) present in git history.
