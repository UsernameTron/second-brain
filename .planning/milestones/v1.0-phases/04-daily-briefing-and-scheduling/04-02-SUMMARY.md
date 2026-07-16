---
phase: 04-daily-briefing-and-scheduling
plan: 02
subsystem: briefing-tests
tags: [jest, contract-tests, tdd, today-command, degradation, slippage-scanner]

requires:
  - phase: 04-daily-briefing-and-scheduling
    plan: 01
    provides: src/today-command.js — runToday() orchestrator under test

provides:
  - Contract test suite for /today command with 24 test cases
  - Verified: 6 sections in decay-rate order (D-03)
  - Verified: D-10 per-section degradation warning format via regex
  - Verified: D-11 total-failure diagnostic checklist
  - Verified: D-08 YAML frontmatter fields
  - Verified: slippage scanner with real temp STATE.md files
  - Verified: frog identification LLM success and heuristic fallback

affects: [04-03-scheduling]

tech-stack:
  added: []
  patterns: [jest-doMock-dynamic-factories, temp-dir-fixtures, tdd-contract-tests]

key-files:
  created:
    - test/today-command.test.js
  modified: []

key-decisions:
  - "Pipeline failure simulated by making briefing-helpers mock reject (not resolve with ok:false) — matches how _getPipelineState() actually detects failure via try/catch"
  - "Date assertion uses raw frontmatter string (date: 2026-04-23) not parsed Date object — avoids gray-matter timezone conversion issues"
  - "FIXED_DATE uses local noon time (2026-04-23T12:00:00) to ensure date stays Apr 23 in all US timezones"
  - "setupMocks() builds briefingHelpersMock conditionally — pipelineSuccess:false causes mocked methods to reject, triggering _getPipelineState() error path"

requirements-completed: [TODAY-01, TODAY-02, TODAY-03, TODAY-04, SCHED-02]

duration: 5min
completed: 2026-04-22
---

# Plan 04-02: /today Command Contract Tests Summary

**24 contract tests verifying the /today command degradation format, section ordering, slippage scanning, frog identification, source health, and frontmatter template**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-22
- **Completed:** 2026-04-22
- **Tasks:** 1
- **Files created:** 1

## Accomplishments

- Created `test/today-command.test.js` (858 lines, 24 test cases)
- Verified all D-03 section names and decay-rate order using `matchAll` on `## heading` patterns
- Asserted D-10 warning format regex `/\[.+\] [A-Z_]+: .+/` on single-connector failure path
- Asserted D-11 diagnostic checklist renders when all 4 sources (calendar, gmail, github, pipeline) fail
- Tested slippage scanner with real temp `STATE.md` files: stale project, active project, malformed YAML, excluded project, no-planning-dir case
- Tested frog identification: LLM success path, heuristic fallback when `classify` returns `success: false`, no-stalled-projects case
- Tested dry-run path prefix (`_dry-run-YYYY-MM-DD.md`) and scheduled mode (no prefix)
- Tested D-08 frontmatter: all required fields present and parseable via gray-matter
- Tested catastrophic no-throw contract: `runToday` returns `{ path: null, briefing: null, error: "TODAY_FATAL:..." }`

## Task Commits

1. **Task 1: Write /today contract tests** - `4119f7c` (test)

## Files Created

- `test/today-command.test.js` - 858 lines, 24 test cases

## Decisions Made

- Pipeline failure path requires `briefing-helpers` mock to reject (not return `ok: false`). The `_getPipelineState()` function uses `Promise.all()` wrapped in try/catch — the catch block fires only when the helpers throw. Returning a resolved value with `ok: false` would still set `ok: true` in the result because `_getPipelineState` derives `ok` from whether the try block succeeded.
- gray-matter auto-parses bare YAML date strings into JS Date objects. The test asserts on the raw briefing string (`result.briefing.toContain('date: 2026-04-23')`) to avoid timezone conversion noise.
- The `setupMocks()` factory double-applies mocks (before and after `jest.resetModules()`) to work around a jest interaction where `doMock` registrations are cleared by `resetModules`. The pattern mirrors the existing test conventions in the project.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pipeline failure mock was not triggering D-11 diagnostic checklist**
- **Found during:** RED phase test run
- **Issue:** When `pipelineSuccess: false`, `briefing-helpers` mock resolved successfully (values returned without throw). `_getPipelineState()` in today-command.js wraps calls in try/catch — only failures that throw are caught and returned as `ok: false`. The resolved mock always returned `ok: true`, keeping `degradedCount < 4` and preventing the D-11 checklist.
- **Fix:** `setupMocks()` now creates `briefingHelpersMock` conditionally. When `pipelineSuccess: false`, both `getProposalsPendingCount` and `getDeadLetterSummary` mock to reject with an Error, matching actual pipeline failure behavior.
- **Files modified:** `test/today-command.test.js`
- **Commit:** `4119f7c` (included in the same atomic task commit)

**2. [Rule 1 - Bug] Date assertion failed due to gray-matter timezone conversion**
- **Found during:** RED phase test run
- **Issue:** `String(parsed.data.date).toContain('2026-04-23')` failed because gray-matter auto-parses YAML date `2026-04-23` as midnight UTC, which displays as Apr 22 in CDT (UTC-5). JavaScript Date.toString() renders the local time.
- **Fix:** Changed assertion to check raw briefing string: `expect(result.briefing).toContain('date: 2026-04-23')`. This is more direct and avoids all timezone ambiguity.
- **Files modified:** `test/today-command.test.js`
- **Commit:** `4119f7c` (included in the same atomic task commit)

## Known Stubs

None — all 24 tests make real assertions against the implementation.

---
*Phase: 04-daily-briefing-and-scheduling*
*Completed: 2026-04-22*

## Self-Check: PASSED

- `test/today-command.test.js` — FOUND (858 lines)
- Task commit `4119f7c` — FOUND
- `npx jest test/today-command.test.js --no-coverage` — 24 passed, 0 failed
- No stubs detected in test file
- All contract points covered: section order, D-10 degradation format, D-11 checklist, D-08 frontmatter, slippage scanner, frog identification, dry-run path, no-throw contract
