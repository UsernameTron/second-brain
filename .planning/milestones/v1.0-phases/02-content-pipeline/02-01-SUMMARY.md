---
phase: 02-content-pipeline
plan: 01
subsystem: infra
tags: [chokidar, json-schema, haiku, anthropic-sdk, correlation-id, dead-letter]

requires:
  - phase: 01-vault-foundation
    provides: vault-gateway.js (path guard, config loading, vaultWrite)
provides:
  - Config files: vault-paths.json (5 new RIGHT dirs), pipeline.json (all thresholds), templates.json (domain overlays + memory categories)
  - JSON schemas for pipeline, templates, and memory-categories config files
  - pipeline-infra.js: Haiku/Sonnet LLM client wrappers, correlation ID generator, dead-letter writer, config loaders
  - Fixed D-48 config hot-reload defect (chokidar replaces fs.watch)
  - configEvents emitter fires config:reloaded on change
affects: [02-02, 02-03, 02-04, 02-05, 02-06]

tech-stack:
  added: [chokidar@3, @anthropic-ai/sdk]
  patterns: [LLM client never-throw pattern, correlation ID propagation, dead-letter frontmatter format]

key-files:
  created:
    - config/vault-paths.json
    - config/pipeline.json
    - config/templates.json
    - config/schema/pipeline.schema.json
    - config/schema/templates.schema.json
    - config/schema/memory-categories.schema.json
    - src/pipeline-infra.js
    - test/pipeline-infra.test.js
    - test/config-schemas.test.js
    - test/config.test.js
  modified:
    - src/vault-gateway.js
    - package.json

key-decisions:
  - "Downgraded chokidar from v5 (ESM-only) to v3 (CJS-compatible) — project uses CommonJS require()"
  - "LLM client classify() returns {success, data/error, failureMode} — never throws per D-36"
  - "Dead-letter files use frontmatter format with status/retry-count fields for lifecycle operations"

patterns-established:
  - "Config loading: loadPipelineConfig/loadTemplatesConfig with required-field validation"
  - "LLM wrapper: createHaikuClient/createSonnetClient return {classify} interface"
  - "Hot-reload: chokidar watcher → 50ms debounce → configEvents.emit('config:reloaded')"

requirements-completed: [INPUT-01, INPUT-03]

duration: 12min
completed: 2026-04-22
---

# Plan 02-01: Pipeline Infrastructure Summary

**Config schemas, pipeline utilities (Haiku client, correlation IDs, dead-letter writer), and chokidar hot-reload fix for vault-gateway**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-04-22
- **Tasks:** 2
- **Files created:** 10
- **Files modified:** 2

## Accomplishments
- 3 config files (vault-paths.json with 5 new RIGHT dirs, pipeline.json with all CONTEXT.md thresholds, templates.json with domain overlays and memory categories)
- 3 JSON schemas for config validation
- pipeline-infra.js with Haiku/Sonnet client wrappers (never-throw pattern), UUID correlation ID generator, dead-letter writer with frontmatter format, and config loaders
- Fixed D-48 config hot-reload defect: replaced unreliable fs.watch with chokidar v3, fires config:reloaded event

## Task Commits

1. **Task 1: Config files, schemas, validation tests** - `54b47c6`
2. **Task 2: Pipeline infra, chokidar hot-reload, Haiku client** - `f733dfa`

## Decisions Made
- Downgraded chokidar v5→v3 for CJS compatibility (agent installed ESM-only v5)
- LLM clients strip markdown code fences from responses before JSON parse
- Dead-letter writer bypasses vaultWrite style lint (infrastructure files)

## Deviations from Plan

### Auto-fixed Issues

**1. chokidar v5 ESM incompatibility**
- **Found during:** Task 2 (orchestrator post-check)
- **Issue:** Agent installed chokidar v5 which is ESM-only, broke all tests using require()
- **Fix:** Downgraded to chokidar@3, added graceful import with fallback to fs.watchFile
- **Files modified:** package.json, src/vault-gateway.js
- **Verification:** 162/162 tests passing

---

**Total deviations:** 1 auto-fixed
**Impact on plan:** Essential fix for CJS compatibility. No scope creep.

## Issues Encountered
- Agent cut off before completing Task 2 commit and SUMMARY — orchestrator finished remaining work

## Next Phase Readiness
- All Wave 2 plans can now import from pipeline-infra.js and use updated config files
- configEvents allows downstream modules to invalidate caches on config change

---
*Phase: 02-content-pipeline*
*Completed: 2026-04-22*
