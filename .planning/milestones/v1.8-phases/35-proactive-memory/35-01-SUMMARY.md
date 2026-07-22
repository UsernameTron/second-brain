---
phase: 35-proactive-memory
plan: 01
subsystem: infra
tags: [sessionstart-hook, recall, content-policy, voyage-health, ajv-schema, fail-open, fail-closed]

# Dependency graph
requires:
  - phase: 19-semantic-embeddings
    provides: runRecall hybrid recall envelope, voyage-health.isDegraded
  - phase: 33-capture-reliability
    provides: checkContent fail-closed egress gate, loadExcludedTerms/loadConfigWithOverlay
provides:
  - SessionStart hook that proactively injects an exclusion-gated digest of relevant recalled memories into every new session
  - sessionInject config block + AJV schema (enabled/topN/tokenCap/latencyUpMs/latencyDegradedMs)
  - Dependency-injected pure core buildSessionMemoryContext with kill switches, latency race, fail-closed egress, whole-entry token cap
affects: [session-start, memory-read-side, today-command]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fail-open infra hook: exit 0 always, any error path returns skipped/empty and never crashes the session"
    - "Latency race with unref'd + cleared timer: Promise.race(recall, budget) that never leaks a handle or delays process exit"
    - "In-process recall with { _internal: true } to avoid inflating recall_count/recall_hits stats"

key-files:
  created:
    - .claude/hooks/session-memory-inject.js
    - test/hooks/session-memory-inject.test.js
  modified:
    - config/pipeline.json
    - config/schema/pipeline.schema.json
    - .claude/settings.json
    - test/config-validator.test.js

key-decisions:
  - "In-process runRecall({_internal:true}) instead of shelling to scripts/recall.js (planner-locked): same behavior, no stats double-count, no second Node boot in the latency-gated path"
  - "Whole-entry token cap via chars/4 heuristic — never truncate a bullet mid-string"
  - "Registered as a SECOND SessionStart entry alongside staleness-check.js, not a replacement"

patterns-established:
  - "SessionStart injection: pure DI core + require.main guard wiring real deps, mirroring staleness-check.js"
  - "Latency budget selection keyed on voyage-health.isDegraded() (250ms degraded / 1000ms up)"

requirements-completed: [INJECT-HOOK-01, INJECT-EGRESS-01, INJECT-KILL-01]

# Metrics
duration: ~35min (incl. worktree recovery)
completed: 2026-07-21
---

# Phase 35: Proactive Memory Summary

**SessionStart hook that injects a ~750-token, exclusion-gated digest of the top-5 hybrid-recalled memories into every new session — fail-open on infra, fail-closed on content, latency-gated, and stats-neutral.**

## Performance

- **Duration:** ~35 min (including recovery from a stalled worktree executor)
- **Completed:** 2026-07-21
- **Tasks:** 3 (all verified)
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments
- `.claude/hooks/session-memory-inject.js` — dependency-injected pure `buildSessionMemoryContext` implementing both kill switches (`SB_SESSION_INJECT=0`, `sessionInject.enabled=false`), a latency race (`isDegraded()`-keyed budget), the reach-exporter fail-closed `checkContent` egress loop, and a whole-entry token cap. `require.main` guard wires real deps and **always exits 0**.
- `sessionInject` config block + AJV schema entry (added to top-level `required[]`, `additionalProperties:false`).
- Registered as a second `SessionStart` hook alongside `staleness-check.js`.
- 14 pure-function tests covering every behavior; full suite green (1479 passed, 29 skipped).

## Task Commits

1. **Task 1: sessionInject config block + AJV schema** — `ae8890e` (feat)
2. **Task 2: session-memory-inject SessionStart hook** — `583a255` (feat)
3. **Task 3: pure-function tests + SessionStart registration** — `bcf445d` (feat)

Deviation fixes (full-suite green):
- **Task 2 correctness: clear latency-race timer** — `a139db1` (fix)
- **Task 1 fallout: sessionInject in validator fixture** — `8a0aaf8` (test)

## Files Created/Modified
- `.claude/hooks/session-memory-inject.js` — the SessionStart hook (fail-open, exit 0 always)
- `test/hooks/session-memory-inject.test.js` — 14 DI pure-function tests (no network)
- `config/pipeline.json` — `sessionInject` block
- `config/schema/pipeline.schema.json` — `sessionInject` schema + required entry
- `.claude/settings.json` — second SessionStart hook registration
- `test/config-validator.test.js` — added `sessionInject` to the valid-pipeline fixture

## Decisions Made
- **In-process recall (planner-locked):** `runRecall([q,'--hybrid','--top','5'], {_internal:true})` rather than shelling to `scripts/recall.js`. `_internal:true` is the clean root fix for the stats double-count risk (shelling cannot pass it), and avoids a second Node boot inside the latency-gated path. Same observable behavior as the ROADMAP wording.
- **Whole-entry token cap:** accumulate bullets until `tokenCap*4` chars, then drop the remainder — never truncate a bullet mid-string.

## Deviations from Plan

### Auto-fixed Issues

**1. [Correctness] Latency-race timer never cleared**
- **Found during:** full-suite regression (`--detectOpenHandles`)
- **Issue:** when recall won the race, the `setTimeout` timer stayed pending up to `budgetMs` — a leaked handle in tests and a delayed exit in the fresh SessionStart process.
- **Fix:** capture the handle, `unref()` it, `clearTimeout` on both success and error paths.
- **Committed in:** `a139db1`

**2. [Required-schema fallout] config-validator fixture missing sessionInject**
- **Found during:** `npm test` after Task 1
- **Issue:** Task 1 added `sessionInject` to the schema's `required[]`; the hardcoded `validPipelineBase` fixture omitted it and began failing validation.
- **Fix:** added the matching `sessionInject` block to the fixture.
- **Committed in:** `8a0aaf8`

---

**Total deviations:** 2 auto-fixed (1 correctness, 1 test-fixture). No scope creep.

## Issues Encountered
- **Worktree executor stalled mid-Task-3.** The gsd-executor ran under worktree isolation, but this repo's Jest config sets `testPathIgnorePatterns: [.claude/worktrees]`, so **no test inside the worktree is discoverable** ("No tests found") — the executor could not self-verify and stopped after committing Tasks 1–2 with the test file left untracked. Recovery: cherry-picked the two executor commits onto `feat/phase-35-proactive-memory` (both branch from `master`, touch only config/hook files — no conflict), copied the untracked test file over, finished Task 3 inline, and verified in the main checkout where Jest resolves normally. The stale worktree was removed.
- **Pre-existing, out of scope:** the full suite emits a "worker process failed to exit gracefully" warning; confirmed present with the new hook test excluded (1494-total baseline). Not introduced by Phase 35; the new hook's isolated `--detectOpenHandles` run is clean after fix `a139db1`.

## User Setup Required
None — no external service configuration required. The hook is live on next session start; disable with `sessionInject.enabled=false` or `SB_SESSION_INJECT=0`.

## Next Phase Readiness
- Phase 36 (decision-gated) is the remaining v1.8 phase. Proactive-memory read-side loop is now closed: new sessions start already aware of relevant prior memories.

---
*Phase: 35-proactive-memory*
*Completed: 2026-07-21*
