---
phase: 18-memory-retrieval-foundation
plan: 02
subsystem: infra
tags: [dependencies, config, schema, ajv, minisearch]

requires: []
provides:
  - minisearch@^7.2.0 production dependency (MIT, pure-JS keyword search)
  - config/pipeline.json `memory.echoThreshold` key (default 0.65)
  - config/schema/pipeline.schema.json validation for the new `memory` object
affects:
  - 18-03-memory-reader (imports minisearch; reads echoThreshold)
  - 18-05-today-memory-echo (reads echoThreshold to gate Memory Echo section)

tech-stack:
  added:
    - "minisearch ^7.2.0 — pure-JS keyword search with BM25 scoring"
  patterns:
    - "New top-level config sections must be declared in pipeline.schema.json with their own additionalProperties:false block"

key-files:
  created:
    - test/unit/pipeline-schema.memory.test.js
  modified:
    - package.json
    - package-lock.json
    - config/pipeline.json
    - config/schema/pipeline.schema.json

key-decisions:
  - "Chose minisearch over fuse.js/lunr — smaller API surface, BM25 out of the box, MIT-licensed, zero runtime deps."
  - "Pinned ^7.2.0 per research recommendation; 7.x is current major."
  - "New memory config lives in its own top-level block (not inside thresholds) so it can grow (Phase 19 semantic) without crowding the existing thresholds section."

patterns-established:
  - "Schema tests live in test/unit/pipeline-schema.*.test.js with one file per config section; each validates positive + negative cases against AJV."

requirements-completed: []

duration: ~30m
completed: 2026-04-24
---

# Plan 18-02: minisearch + echoThreshold Schema Summary

**Added the minisearch dependency and opened the pipeline config/schema to accept a new `memory.echoThreshold` key — the AJV foundation for Memory Echo gating in Wave 3.**

## Performance

- **Duration:** ~30m
- **Tasks:** 2
- **Files modified:** 5 (1 schema test created, 4 infrastructure files modified)

## Accomplishments

- Installed `minisearch@^7.2.0` as a production dependency. `npm ls minisearch` shows 7.2.x resolved.
- Added `test/unit/pipeline-schema.memory.test.js` (RED phase) — AJV validation tests that initially failed.
- Extended `config/schema/pipeline.schema.json` with a new top-level `memory` object containing `echoThreshold` (number, 0..1) and `additionalProperties: false`.
- Added `"memory": { "echoThreshold": 0.65 }` to `config/pipeline.json`.

## Task Commits

1. **Task 1: Install minisearch@^7.2.0** — `f3d18b3` (chore)
2. **Task 2 (RED): Add failing schema tests for memory.echoThreshold** — `d146666` (test)
2. **Task 2 (GREEN): Add memory.echoThreshold config key + schema** — `38e8dba` (feat)

## Files Created/Modified

- `package.json` / `package-lock.json` — Adds `minisearch ^7.2.0` under `dependencies`.
- `config/pipeline.json` — New `memory.echoThreshold: 0.65` key.
- `config/schema/pipeline.schema.json` — New top-level `memory` object with `echoThreshold` validation.
- `test/unit/pipeline-schema.memory.test.js` — AJV positive/negative tests for the new key (valid range, rejected out-of-range, rejected extras).

## Decisions Made

- **minisearch chosen** over alternatives (fuse.js, lunr) per research: smallest API, BM25-equivalent scoring, zero runtime deps, MIT license.
- **Config key placement:** Put in new top-level `memory` object rather than nested under `thresholds` — gives Phase 19 room to add semantic-memory config keys without schema surgery.

## Deviations from Plan

None — plan executed as written. Intermediate commit between RED and GREEN intentional (TDD cycle).

## Issues Encountered

- 18-01 was running in parallel and had intermediate uncommitted state in `src/promote-memories.js` mid-wave. The 18-02 executor correctly identified this as out-of-scope and stopped rather than auto-fixing. Orchestrator completed the GREEN commit after 18-01 finished.

## Next Phase Readiness

Wave 2 (18-03 memory-reader.js) can:
- `require('minisearch')` for keyword search
- Read `config.memory.echoThreshold` via the standard config loader (AJV will accept it)

Wave 3 (18-05 today-memory-echo) can gate the Memory Echo section on `config.memory.echoThreshold`.

---
*Phase: 18-memory-retrieval-foundation*
*Completed: 2026-04-24*
