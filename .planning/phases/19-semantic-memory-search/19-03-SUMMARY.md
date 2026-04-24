---
phase: 19-semantic-memory-search
plan: "03"
subsystem: semantic-memory
tags: [promote-memories, recall-command, embed-on-promotion, semantic-search, hybrid-search, degradation]

# Dependency graph
requires:
  - phase: 19-semantic-memory-search
    plan: "02"
    provides: src/semantic-index.js (indexNewEntries, semanticSearch, hybridSearch public API)
provides:
  - src/promote-memories.js — embed-on-promotion wired via lazy require + try/catch (MEM-EMBED-01)
  - src/recall-command.js — --semantic and --hybrid flags with graceful degradation (MEM-SEMANTIC-01, MEM-DEGRADE-01)
affects: [19-04-recall-semantic, 19-05-uat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy require inside try/catch for optional semantic dependency — promote-memories loads without semantic-index if engine has a bug"
    - "Snippet fallback: usedSemanticPath branch uses h.content?.slice(0,100) because semantic-index hits carry content, not pre-computed snippet"
    - "no-useless-assignment lint rule: removed redundant hits=[] inside blocked branches (hits already [] from initialization)"

key-files:
  created: []
  modified:
    - src/promote-memories.js
    - src/recall-command.js
    - test/unit/recall-command.test.js

key-decisions:
  - "Lazy require('./semantic-index') inside try/catch in appendToMemoryFile — non-fatal embed; promotion already committed to disk before embed is attempted"
  - "Both require('./semantic-index') calls in recall-command are lazy (inside if/else branches) — keyword-only /recall never loads semantic-index"
  - "Test P1/P7 updated to expect.objectContaining() — additive new flags (semantic/hybrid) broke strict toEqual; deviation documented (Rule 1)"

# Metrics
duration: ~4min
completed: 2026-04-24
---

# Phase 19 Plan 03: CLI Integration (promote-memories + recall-command) Summary

**Surgical wiring of the Plan 02 engine into the two CLI entry points: embed-on-promotion hook in promote-memories.js and --semantic/--hybrid flag routing with graceful degradation in recall-command.js**

## Performance

- **Duration:** ~4 min
- **Completed:** 2026-04-24
- **Tasks:** 2
- **Files modified:** 2 src + 1 test

## Accomplishments

**Task 1 — promote-memories.js embed hook (cb2c9d8)**

Added a `try/catch` block immediately after `fs.writeFileSync(memoryFile, newContent, 'utf8')` in `appendToMemoryFile`. Uses lazy `require('./semantic-index')` inside the try block so the module loads only when called, never blocking promote-memories from loading if semantic-index has a bug. Failures logged via `console.error` with `[promote-memories] Semantic indexing failed (non-fatal):` prefix. All 33 promote-memories tests pass.

**Task 2 — recall-command.js flag routing (349f993)**

- `parseRecallArgs`: added `semantic: false, hybrid: false` to default flags; added `--semantic` and `--hybrid` else-if branches after `--top`.
- `runRecall`: replaced single-path keyword-only body with three-branch router (hybrid → semantic → keyword). Lazy requires for semantic-index in both semantic/hybrid branches. Degradation banners match spec exactly: `(semantic unavailable — using keyword only)` and `(hybrid unavailable — using keyword only)`. Blocked results surface explicit `(blocked: …)` line. Keyword-only path (no flags) is byte-for-byte unchanged from pre-plan behavior.
- Return shape extended with `mode`, `degraded`, `degradedBanner`, `blocked`, `blockedReason` — additive, no breaking changes.
- All 35 recall tests pass (33 existing + 2 new assertions for semantic/hybrid flag defaults).

## Task Commits

| Task | Name | Commit |
|------|------|--------|
| 1 | Wire indexNewEntries embed-on-promotion into promote-memories.js | cb2c9d8 |
| 2 | Wire --semantic/--hybrid flags into recall-command with graceful degradation | 349f993 |

## Files Created/Modified

- `src/promote-memories.js` — 12-line additive block after writeFileSync in appendToMemoryFile; no other changes
- `src/recall-command.js` — parseRecallArgs extended with 2 new flags; runRecall body replaced with 3-branch router (~80 lines net add)
- `test/unit/recall-command.test.js` — P1 and P7 updated to `expect.objectContaining()` to accommodate new flag fields (deviation, Rule 1)

## Decisions Made

- **Lazy require in promote-memories**: `require('./semantic-index')` is inside the `try` block, not at module top. This means promote-memories can still load and run even if semantic-index has a syntax error or missing dependency — embed-on-promotion is best-effort, promotion is mandatory.
- **No hits=[] in blocked branches**: Removed redundant `hits = []` assignments in hybrid/semantic blocked branches because `hits` is already initialized to `[]` on entry. This satisfies the `no-useless-assignment` ESLint rule.
- **snippet fallback on semantic/hybrid path**: `h.snippet || (h.content ? String(h.content).slice(0, 100) : '')` — semantic-index result objects carry `content` not `snippet`. Keyword path preserves `h.snippet` exactly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test P1 and P7 used strict `toEqual` on the flags object**
- **Found during:** Task 2 test run
- **Issue:** `expect(flags).toEqual({ category: null, since: null, top: 5 })` fails when `semantic: false, hybrid: false` are added to defaults. The plan required both adding new flags AND keeping existing tests passing — a contradiction when tests use strict equality on the full object.
- **Fix:** Updated P1 and P7 assertions to `expect.objectContaining({ category: null, since: null, top: 5 })` plus explicit `expect(flags.semantic).toBe(false)` and `expect(flags.hybrid).toBe(false)` assertions. This preserves the original test intent (verify existing defaults) while also asserting the new fields have correct defaults.
- **Files modified:** `test/unit/recall-command.test.js` (2 test cases)
- **Commit:** included in 349f993

**2. [Rule 1 - Bug] ESLint `no-useless-assignment` on `hits = []` in blocked branches**
- **Found during:** Task 2 post-implementation lint
- **Issue:** `hits = []` inside `if (res.blocked)` branches was flagged because `hits` is initialized to `[]` before the try block and not reassigned before those branches.
- **Fix:** Removed the redundant `hits = []` lines in both the hybrid and semantic blocked branches.
- **Files modified:** `src/recall-command.js`
- **Commit:** included in 349f993

---

**Total deviations:** 2 auto-fixed (Rule 1 — test strictness + lint gate)
**Impact on plan:** No scope change. All must-haves satisfied.

## Must-Haves Verification

- [x] `src/promote-memories.js` calls `indexNewEntries(promotedCandidates)` after `fs.writeFileSync` succeeds
- [x] Embed-time failures do NOT abort promotion — wrapped in try/catch with warning log
- [x] `parseRecallArgs` recognizes `--semantic` and `--hybrid` as boolean flags
- [x] `runRecall` routes to `semanticSearch` or `hybridSearch` when flags set, falls back to keyword on `{degraded:true}`
- [x] Fallback banner text matches spec: `(semantic unavailable — using keyword only)` and `(hybrid unavailable — using keyword only)`
- [x] Excluded-term blocks surface as explicit blocked messaging — not silently degraded
- [x] `/recall` (no flags) behavior unchanged — same keyword-only path
- [x] All existing recall tests pass (with minimal test-assertion update to `objectContaining`)

## Known Stubs

None. All integration points are fully wired. No TODOs, FIXMEs, or placeholder values in modified files.

---

## Self-Check: PASSED

Files verified:
- `src/promote-memories.js` — FOUND, `indexNewEntries` call present within 6 lines of writeFileSync
- `src/recall-command.js` — FOUND, 3 occurrences of `flags.semantic`, 3 of `flags.hybrid`, 2 lazy requires for semantic-index
- `test/unit/recall-command.test.js` — FOUND, P1/P7 updated, all 35 tests green

Commits verified:
- `cb2c9d8` — promote-memories Task 1
- `349f993` — recall-command Task 2

Acceptance criteria:
- `grep -A 6 "writeFileSync" src/promote-memories.js | grep -q indexNewEntries`: PASSED
- `grep -c "flags.semantic" src/recall-command.js` ≥ 3: PASSED (3)
- `grep -c "flags.hybrid" src/recall-command.js` ≥ 3: PASSED (3)
- Both require('./semantic-index') calls are lazy (inside if/else): VERIFIED (lines 60, 74)
- Degradation banners match spec exactly: VERIFIED
- `npx jest --forceExit test/unit/recall-command test/integration/recall-end-to-end test/promote-memories`: 68 passed
- `npm run lint`: 0 errors
- Smoke parse test: `{"query":"leadership","flags":{"category":null,"since":null,"top":3,"semantic":true,"hybrid":false}}`: PASSED

Stub scan: No TODOs, FIXMEs, throw-not-implemented, or placeholder values found in modified files.

---
*Phase: 19-semantic-memory-search*
*Completed: 2026-04-24*
