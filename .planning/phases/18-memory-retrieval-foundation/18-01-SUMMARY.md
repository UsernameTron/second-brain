---
phase: 18-memory-retrieval-foundation
plan: 01
subsystem: refactor
tags: [utilities, deduplication, memory, hashing]

requires: []
provides:
  - src/utils/memory-utils.js with null-safe computeHash and sourceRefShort
  - Deduplicated hash/source-ref logic across promote-memories and memory-extractor
affects:
  - 18-03-memory-reader (imports sourceRefShort + computeHash)
  - 18-04-recall-command (imports sourceRefShort)

tech-stack:
  added: []
  patterns:
    - "Centralized pure-function utilities in src/utils/ with unit tests"

key-files:
  created:
    - src/utils/memory-utils.js
    - test/unit/memory-utils.test.js
  modified:
    - src/promote-memories.js
    - src/memory-extractor.js

key-decisions:
  - "Kept null-safe computeHash variant (from promote-memories.js) as canonical — the memory-extractor.js variant crashed on null input, and null-safety is preferred."
  - "Extracted both computeHash and sourceRefShort in one plan (not split) — they share a call site in the forthcoming recall-command.js."

patterns-established:
  - "src/utils/ reserved for pure, well-tested, cross-module helpers that have no vault I/O"

requirements-completed: []

duration: ~25m
completed: 2026-04-24
---

# Plan 18-01: memory-utils Extraction Summary

**Consolidated `computeHash` and `sourceRefShort` into a single shared utilities module so downstream Phase 18 code (memory-reader, recall-command) has one canonical import path.**

## Performance

- **Duration:** ~25m
- **Tasks:** 2
- **Files modified:** 4 (1 created util, 1 created test, 2 migrated)

## Accomplishments

- Created `src/utils/memory-utils.js` with 2 exports: `computeHash(content)` (null-safe SHA-256 truncation) and `sourceRefShort(sourceRef)` (display-formatter for session/file/daily refs).
- Created `test/unit/memory-utils.test.js` with 16 unit tests (100% coverage on memory-utils.js).
- Migrated `src/promote-memories.js` to import both helpers; removed local duplicates and unused `crypto` require.
- Migrated `src/memory-extractor.js` to import `computeHash`; removed local duplicate.

## Task Commits

1. **Task 1: Create src/utils/memory-utils.js with shared helpers** — `c48c99d` (feat)
2. **Task 2: Migrate promote-memories + memory-extractor** — `2486caa` (refactor: memory-extractor) + `0d96800` (refactor: promote-memories cleanup)

## Files Created/Modified

- `src/utils/memory-utils.js` — Two pure-function exports (computeHash, sourceRefShort) with no I/O.
- `test/unit/memory-utils.test.js` — 16 unit tests covering null/empty/malformed inputs and all sourceRef prefix variants.
- `src/promote-memories.js` — Imports from `./utils/memory-utils`; local duplicates and `crypto` require removed.
- `src/memory-extractor.js` — Imports `computeHash` from `./utils/memory-utils`; local duplicate removed.

## Decisions Made

- **Null-safe computeHash is canonical.** `promote-memories.js` had a null-safe variant (`(content || '').trim()`) while `memory-extractor.js` had an unsafe variant that would crash on null. Kept the null-safe version.
- **Migration committed in two atomic steps** (one per consumer file) for clean git history.

## Deviations from Plan

None — plan executed as written. Task 2 split into two commits because the first pass committed only memory-extractor.js (believing promote-memories had already been migrated in Task 1 scope) and a follow-up commit was needed to remove the local function bodies from promote-memories.js. Commit messages explain the sequencing.

## Issues Encountered

- Pre-existing UAT classification test (`test/uat/uat-classification.test.js`) is flaky on local runs (0/8 deterministic cases passing vs. 80% threshold). Verified pre-existing on clean HEAD; not caused by Phase 18 changes. Tracked separately.

## Next Phase Readiness

Plan 18-03 (`src/memory-reader.js`) can import `sourceRefShort` and `computeHash` from the new utils module. Plan 18-04 (`src/recall-command.js`) can import `sourceRefShort`. Wave 2 unblocked.

---
*Phase: 18-memory-retrieval-foundation*
*Completed: 2026-04-24*
