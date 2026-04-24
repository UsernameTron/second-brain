---
phase: 18-memory-retrieval-foundation
plan: 03
subsystem: api
tags: [memory, search, minisearch, keyword, relevance, scoring]

requires:
  - phase: 18-01-memory-utils-extraction
    provides: [sourceRefShort, computeHash]
  - phase: 18-02-minisearch-schema
    provides: [minisearch dependency, memory.echoThreshold config]
provides:
  - src/memory-reader.js with 3 exports (readMemory, searchMemoryKeyword, getMemoryEcho)
  - test/fixtures/memory-sample.md fixture shared with Wave 3 tests
affects:
  - 18-04-recall-command (consumes searchMemoryKeyword)
  - 18-05-today-memory-echo (consumes getMemoryEcho)
  - 18-06-integration-uat (end-to-end verification)

tech-stack:
  added: []
  patterns:
    - "Async memory reader: returns [] on missing file (no throw), stderr.write for warnings (no console.log)"
    - "In-memory minisearch index built fresh per call — ~500-entry vault parses in <50ms"

key-files:
  created:
    - src/memory-reader.js
    - test/unit/memory-reader.test.js
    - test/fixtures/memory-sample.md
  modified: []

key-decisions:
  - "Index built per-call, not cached — Phase 18 prioritizes simplicity; Phase 19 can add memoization if p95 latency warrants"
  - "Malformed entry headers emit a one-line stderr warning and are skipped (data never blocks the reader)"
  - "Memory Echo scoring uses simple token-overlap ratio against calendar topics + VIP email subjects; entries scoring >= threshold (default 0.65) are returned"
  - "getMemoryEcho returns top-5 entries max (MAX_ECHO_ENTRIES constant) to keep /today briefing concise"

patterns-established:
  - "Memory Echo signal extraction: concat calendar event titles + VIP email subjects → tokenize → bag-of-words match against entry content"

requirements-completed:
  - MEM-READ-01
  - MEM-SEARCH-KW-01

duration: ~45m
completed: 2026-04-24
---

# Plan 18-03: memory-reader.js Summary

**Built the core read-path module that parses `memory/memory.md` and exposes keyword search + relevance scoring — the foundation Wave 3 (recall-command + today-command) consumes.**

## Performance

- **Duration:** ~45m
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files created:** 3 (module, test, fixture)
- **Coverage:** 95.45% statements, 97.82% lines, 100% functions on `src/memory-reader.js`

## Accomplishments

- **`readMemory()`**: Parses the vault's `memory/memory.md` (`## YYYY-MM` month headers + `### YYYY-MM-DD · CATEGORY · SHORT-REF` entry headers + `key:: value` inline fields). Returns `[]` when file missing — no throw, no crash, satisfies ROADMAP SC3.
- **`searchMemoryKeyword(query, options)`**: Builds a minisearch index over entries (fields: content; storeFields: id/category/content/date/sourceRef/contentHash; searchOptions: `{ boost: { content: 2 }, fuzzy: 0.2, prefix: true, combineWith: 'AND' }`). Supports `{ category, since }` options. Returns results with `score` and 100-char `snippet` pre-computed.
- **`getMemoryEcho(connectorResults, options)`**: Extracts signal from calendar event titles + VIP email subjects, scores each memory entry by token overlap, filters by `threshold` (default 0.65 from config.memory.echoThreshold), returns up to 5 entries.
- **Test fixture** (`test/fixtures/memory-sample.md`): Realistic memory.md with multiple DECISION and LEARNING entries spanning ≥2 months — shared with 18-04 and 18-06.
- **22 unit tests** covering: valid parse, empty file, missing file, malformed header skip, category/since filters, snippet length, Memory Echo threshold, empty connector results, quoted phrases.

## Task Commits

1. **Task 1 (RED): Tests + fixture** — `049ab32` (test: failing tests for memory-reader) + `49081fe` (chore: fixture)
2. **Task 2 (GREEN): Implementation** — `5e68d3f` (feat: memory-reader.js with 3 exports)
3. **Lint fixes** — `c37fc09` (chore: jest/valid-title + eqeqeq corrections)

## Files Created/Modified

- `src/memory-reader.js` (377 lines) — Three exports + internal helpers `_snippet`, `_parseFields`. Uses `process.stderr.write` for malformed-header warnings (no `console.log`).
- `test/unit/memory-reader.test.js` (254 lines) — 22 tests with tmp-dir VAULT_ROOT fixtures for isolation. Covers all ROADMAP SC paths.
- `test/fixtures/memory-sample.md` — Canonical fixture used by 18-03 + 18-04 + 18-06.

## Decisions Made

- **No caching**: Index built on each call. Vault is small (<1000 entries typical), parse is fast. Phase 19 can memoize when semantic search lands.
- **stderr.write, not console**: CLAUDE.md forbids `console.log` in production; `process.stderr.write` is allowed and gives operators a one-line signal when memory.md has malformed entries without crashing.
- **Strict eqeqeq**: All null/undefined guards use `=== null || === undefined` per project ESLint config.

## Deviations from Plan

None functionally. Two lint corrections post-commit:
1. `==`/`!=` → `===`/`!==` in getMemoryEcho guards (eqeqeq).
2. Jest test title de-prefixing in 18-02's `pipeline-schema.memory.test.js` (removed `"Test N: "` prefixes per `jest/valid-title`). This was a drive-by fix of prior-wave lint errors that the parallel wave didn't catch.

## Issues Encountered

- First executor agent stalled after confirming lint was clean but before committing the feat. Orchestrator completed commits + summary inline.
- Pre-existing UAT classification flake unchanged (verified on clean HEAD earlier).

## Next Phase Readiness

- **18-04 (recall-command.js)** can `require('./memory-reader')` and consume `searchMemoryKeyword` directly. `sourceRefShort` from 18-01's utils flows through.
- **18-05 (today Memory Echo)** can `require('./memory-reader')` and call `getMemoryEcho(connectorResults, { threshold: config.memory.echoThreshold })`. The insertion point in `today-command.js` (line ~171, after frogData) from research is unchanged.
- Wave 3 can execute in parallel (18-04 and 18-05 touch different files).

---
*Phase: 18-memory-retrieval-foundation*
*Completed: 2026-04-24*
