---
phase: 18-memory-retrieval-foundation
plan: 05
subsystem: ui
tags: [today, memory, briefing, integration, renderer]

requires:
  - phase: 18-02-minisearch-schema
    provides: [memory.echoThreshold config]
  - phase: 18-03-memory-reader
    provides: [getMemoryEcho]
provides:
  - Memory Echo section in /today briefing (between Frog and GitHub)
  - Config-driven threshold plumbing (memory.echoThreshold → getMemoryEcho options)
  - Graceful error isolation: memory read failures don't break the briefing
affects:
  - 18-06-integration-uat (exercises end-to-end Memory Echo path)

tech-stack:
  added: []
  patterns:
    - "Spread-based conditional section insertion in markdown renderer — heading+body BOTH absent when no data (vs. empty heading)"
    - "try/catch around optional data sources in /today so any one source failing never breaks the full briefing"

key-files:
  created:
    - test/unit/today-memory-echo.test.js
    - test/unit/briefing-renderer.memory-echo.test.js
  modified:
    - src/today-command.js
    - src/today/briefing-renderer.js

key-decisions:
  - "Memory Echo section absent ENTIRELY when no entries (no empty heading, no blank body) — uses array-spread `...(body !== null ? [heading, '', body, ''] : [])` pattern per ROADMAP SC4 literal wording"
  - "getMemoryEcho failure is swallowed (returns { entries: [], score: 0, skipped: true }) — briefing generation is the single source of truth; a memory read crash must never break /today"
  - "Threshold read as `config.memory?.echoThreshold || 0.65` with explicit typeof number guard to handle partially-malformed configs"
  - "Inserted between Frog and GitHub per research (line 171 in today-command.js, between ## Frog and ## GitHub in briefing-renderer.js)"

patterns-established:
  - "Optional briefing sections: compute body separately, use null sentinel for 'absent', spread into array only when non-null"

requirements-completed:
  - TODAY-ECHO-01

duration: ~35m
completed: 2026-04-24
---

# Plan 18-05: Memory Echo in /today Summary

**Wired the compounding memory layer into the daily briefing: `/today` now surfaces memory entries relevant to today's calendar + VIP emails as a new "Memory Echo" section, with the section absent entirely when no memory crosses the 0.65 relevance threshold.**

## Performance

- **Duration:** ~35m (planned), executed partially by agent then completed inline
- **Tasks:** 2 (RED tests + GREEN implementation)
- **Files created:** 2 test files
- **Files modified:** 2 source files

## Accomplishments

- **today-command.js**: New import `getMemoryEcho` from `./memory-reader`. New block between `frogData` and `generateSynthesis` that reads `config.memory.echoThreshold` (default 0.65), invokes `getMemoryEcho(connectorResults, { threshold })`, and passes the result into `renderBriefing`. Error path returns `{ entries: [], score: 0, skipped: true }`.
- **briefing-renderer.js**: New `_renderMemoryEchoSection` helper returning `null` when empty. `renderBriefing` uses spread syntax to insert heading+body only when non-null. Section appears between `## Frog` and `## GitHub`. Handles missing fields gracefully (`UNKNOWN` category, `unknown` source-ref fallbacks).
- **today-memory-echo.test.js**: 4 tests covering (T1) entries propagate to renderBriefing, (T2) thrown errors → empty memoryEcho with skipped flag, (T3) explicit threshold plumbing, (T4) default 0.65 when config.memory absent.
- **briefing-renderer.memory-echo.test.js**: 5 tests covering (R1) entries render + correct placement, (R2) heading absent when empty, (R3) skipped path same as empty, (R4) undefined memoryEcho backwards-compat, (R5) missing-field entries render with fallbacks.

## Task Commits

1. **RED tests** — `ba52497` (test: add RED tests for Memory Echo in today-command and briefing-renderer)
2. **GREEN implementation** — `f36696f` (feat: wire Memory Echo into /today briefing)

## Files Created/Modified

- `test/unit/today-memory-echo.test.js` (209 lines, 4 tests) — Integration-style unit tests with module mocking.
- `test/unit/briefing-renderer.memory-echo.test.js` (111 lines, 5 tests) — Pure rendering tests with synthetic data.
- `src/today-command.js` — Added `getMemoryEcho` import, threshold resolution, wrapped invocation, `memoryEcho` passed to `renderBriefing`.
- `src/today/briefing-renderer.js` — Added `_renderMemoryEchoSection` helper and conditional section insertion via array spread.

## Decisions Made

- **Section absent when empty, not rendered as empty heading.** ROADMAP SC4 says "absent entirely when no entry crosses the threshold" — array-spread pattern enforces this literally. A rendered `## Memory Echo\n\n_No memories_` form would have violated the wording.
- **Error swallowed, not rethrown.** `/today` is Pete's primary productivity surface; a memory read bug must never block the briefing. Failure state is observable (`memoryEcho.skipped === true`) for downstream telemetry.
- **Config read with typeof guard.** `config?.memory?.echoThreshold` with `typeof === 'number'` check handles the case where the schema validator lets through a partially-valid config during startup.

## Deviations from Plan

**Partial agent execution, orchestrator completion.** The 18-05 executor agent was spawned with `isolation="worktree"` (auto-assigned by the Task runtime) and created the RED test file in its worktree. It stalled before wiring the implementation because Jest config excludes `.claude/worktrees/` from test runs — the agent correctly identified this as a blocker but didn't work around it. Orchestrator pulled the RED test from the worktree, wired the implementation inline on the main branch, added the second test file (briefing-renderer), and committed atomically as if the agent had completed.

## Issues Encountered

- 18-05 worktree based on pre-Phase-18 commit — the agent's isolated branch diverged before Wave 1/2 merged. Moot once the orchestrator took over on the correct branch.
- Pre-existing UAT classification flake unchanged (unrelated).

## Next Phase Readiness

- All 4 ROADMAP success criteria now reachable end-to-end:
  - SC1 (`/recall "leadership"` returns list) — covered by 18-04
  - SC2 (flags work) — covered by 18-04
  - SC3 (missing memory.md → empty) — covered by 18-03/18-04
  - SC4 (Memory Echo in /today) — covered by 18-05 ← this plan
- Wave 4 (18-06 integration + UAT) can now write end-to-end tests exercising real connectors → memory-reader → renderBriefing full path.

---
*Phase: 18-memory-retrieval-foundation*
*Completed: 2026-04-24*
