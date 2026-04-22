---
phase: 03-external-integrations
plan: 04
subsystem: api
tags: [github, mcp, docker-mcp, connectors, activity-feed]

# Dependency graph
requires:
  - phase: 03-01
    provides: SOURCE enum, makeResult, makeError, loadConnectorsConfig, test helpers (assertSuccessShape, assertErrorShape)

provides:
  - src/connectors/github.js — getGitHubActivity(mcpClient, options) with UsernameTron repo scoping
  - test/connectors/github.test.js — 26 unit tests with mocked Docker MCP transport

affects: [04-today, any consumer of GitHub activity data]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy memoized config loader (_config + _getConfig()) pattern for connector-level config isolation"
    - "Promise.allSettled per-tool within _fetchRepo() for partial failure tolerance"
    - "Client-side PR filtering by updated_at (list_pull_requests lacks since param)"
    - "Warnings array embedded in data (not on result shape) to preserve exact D-15 5-field contract"

key-files:
  created:
    - src/connectors/github.js
    - test/connectors/github.test.js
  modified: []

key-decisions:
  - "PR time-window filtering done client-side because list_pull_requests lacks a since param — filter by updated_at after fetch"
  - "Partial failure returns makeResult with warnings[] in data, not makeError — preserves partial data for /today degraded mode (D-20)"
  - "Total failure (all calls fail) returns makeError — empty data has no value for briefing"
  - "warnings embedded inside data object to keep result shape exactly 5 fields per D-15 contract"

patterns-established:
  - "Connector module-level _config memoization: reset via jest.resetModules() in tests to honour CONFIG_DIR_OVERRIDE at call time"
  - "withTempConfig() in tests writes full valid connectors.json (all 3 sections) to pass schema validation"

requirements-completed: [INTG-03]

# Metrics
duration: 12min
completed: 2026-04-22
---

# Phase 3 Plan 4: GitHub Connector Summary

**Docker MCP GitHub connector composing list_commits + list_issues + list_pull_requests per UsernameTron repo, with client-side PR window filtering and partial-failure tolerance**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-22T~21:00Z
- **Completed:** 2026-04-22T~21:12Z
- **Tasks:** 1 (TDD: RED commit + GREEN commit)
- **Files modified:** 2

## Accomplishments

- GitHub connector `src/connectors/github.js` with `getGitHubActivity(mcpClient, options)` export
- Repo scoping to `config.owner` / `config.repos` — no consumer-side filtering needed (D-12)
- Correct tool surface: `list_commits`, `list_issues`, `list_pull_requests` — not the fictional `list_user_events`
- PR window filtering client-side by `updated_at` since `list_pull_requests` lacks a `since` param
- Partial failure tolerance: some tools throwing returns `makeResult` with `warnings[]` in data
- Total failure returns `makeError` — all errors caught, never throws (D-18)
- 26 unit tests passing, all using mocked mcpClient for zero network dependency

## Task Commits

Each task committed atomically with TDD pattern:

1. **Task 1 RED: add failing tests for GitHub connector** - `628b17b` (test)
2. **Task 1 GREEN: implement GitHub connector** - `a698fd0` (feat)

## Files Created/Modified

- `/Users/cpconnor/projects/second-brain/src/connectors/github.js` — GitHub connector, getGitHubActivity export
- `/Users/cpconnor/projects/second-brain/test/connectors/github.test.js` — 26 unit tests with mock mcpClient

## Decisions Made

- **PR filtering is client-side**: `list_pull_requests` has no `since` param. Connector fetches all open PRs and filters by `updated_at >= since` after receipt. This is documented in both code and tests.
- **Partial failure returns makeResult**: When some (but not all) tool calls fail, connector returns `makeResult` with available data plus a `warnings` array inside `data`. The `warnings` field lives inside `data` (not on the result itself) so the D-15 exact 5-field shape is preserved. This enables `/today`'s degraded-mode handling (D-20).
- **Total failure returns makeError**: When all tool calls across all repos fail, `makeError` is returned. Partial data from zero sources has no briefing value.

## Deviations from Plan

None — plan executed exactly as written.

The plan explicitly specified the `warnings` array inside `data` for partial failures, the client-side PR filtering requirement, and the `Promise.allSettled` pattern. Implementation followed the spec precisely.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required beyond what was already configured for Docker MCP in earlier plans.

## Next Phase Readiness

- All three connector modules are now complete: `calendar.js`, `gmail.js`, `github.js`
- Phase 4 (`/today`) can fan out via `Promise.allSettled` across all three connectors
- Each connector returns uniform D-15 shape — `/today` checks `result.success` and surfaces `result.error` as warning if false (D-20)
- No blockers for Phase 4 execution

---
*Phase: 03-external-integrations*
*Completed: 2026-04-22*

## Self-Check: PASSED

- `src/connectors/github.js` — FOUND
- `test/connectors/github.test.js` — FOUND
- Commit `628b17b` (RED test) — FOUND
- Commit `a698fd0` (GREEN impl) — FOUND
- 26/26 tests pass
- No stubs in github.js
- D-15 shape contract maintained (exact 5-field result, warnings inside data)
