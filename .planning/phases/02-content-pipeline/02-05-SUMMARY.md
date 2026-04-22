---
phase: 02-content-pipeline
plan: 05
subsystem: pipeline
tags: [promote-memories, promote-unrouted, reroute, wikilinks, integration]

requires:
  - phase: 02-content-pipeline/02
    provides: classifier, note-formatter, /new command
  - phase: 02-content-pipeline/03
    provides: wikilink engine
  - phase: 02-content-pipeline/04
    provides: memory proposals reader/writer
provides:
  - /promote-memories: batch promote accepted candidates from memory-proposals.md to memory.md
  - /promote-unrouted: reclassify dead-letter files from proposals/unrouted/
  - /reroute: reclassify and move dead-letter or left-proposal files
  - Wikilink integration in /new pipeline (Stage 4 post-write)
  - Integration tests for end-to-end pipeline
affects: [phase-03, phase-04]

tech-stack:
  added: []
  patterns: [batch promotion with cap and archive, reroute pipeline reuse]

key-files:
  created:
    - src/promote-unrouted.js
    - src/reroute.js
    - test/promote-unrouted.test.js
    - test/reroute.test.js
    - test/integration-pipeline.test.js
  modified:
    - src/new-command.js

key-decisions:
  - "Wikilink enrichment is non-blocking per D-39 — failures logged but never block pipeline"
  - "Reroute reuses classifyInput for full pipeline re-invocation"
  - "jest.doMock used instead of jest.mock in reroute tests for dynamic mock configuration"

patterns-established:
  - "Post-write enrichment pattern: write first, enrich after, re-write if enriched"
  - "Reroute shares pipeline stages with /new — no duplication"

requirements-completed: [INPUT-01, INPUT-02, INPUT-04, MEM-01]

duration: 18min
completed: 2026-04-22
---

# Plan 02-05: Memory Promotion + Dead-Letter Commands Summary

**Promote-memories, promote-unrouted, reroute commands, and wikilink integration wired into /new pipeline**

## Performance

- **Duration:** ~18 min
- **Completed:** 2026-04-22
- **Tasks:** 2
- **Files created:** 5, modified: 1

## Accomplishments
- /promote-memories: batch promotion from memory-proposals.md to memory.md with cap, dedup, and archiving
- /promote-unrouted: reclassify dead-letter files with pipeline re-invocation
- /reroute: move and reclassify dead-letters or left-proposals to correct destinations
- Wired wikilink suggestions into /new pipeline (Stage 4 post-write, non-blocking per D-39)
- End-to-end integration tests for full pipeline flow

## Task Commits

1. **Task 1: Promote-memories** - `d01d1cf`
2. **Task 2: Promote-unrouted, reroute, wikilink wiring** - `08d1b7f`

## Decisions Made
- Wikilink enrichment writes twice (initial write, then enriched re-write) to avoid blocking
- Fixed reroute test jest.mock scoping issue — used jest.doMock for dynamic mock configuration

## Deviations from Plan

### Auto-fixed Issues

**1. jest.mock scoping violation in reroute tests**
- **Found during:** orchestrator test verification
- **Issue:** jest.mock factory referenced outer-scope variables (stage0Result, etc.)
- **Fix:** Switched to jest.doMock with locally-scoped mock variables
- **Verification:** All 9 reroute tests pass

---

**Total deviations:** 1 auto-fixed
**Impact on plan:** Test infrastructure fix. No scope creep.

## Issues Encountered
- Agent cut off before committing Task 2 and wiring wikilinks — orchestrator completed remaining work

---
*Phase: 02-content-pipeline*
*Completed: 2026-04-22*
