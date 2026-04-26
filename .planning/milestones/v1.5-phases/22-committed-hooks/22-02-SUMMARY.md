---
phase: 22-committed-hooks
plan: 02
status: complete
started: 2026-04-26T13:38:00.000Z
completed: 2026-04-26T13:48:00.000Z
---

# Plan 22-02 Summary: Remove dotenv.config() from pipeline-infra.js

## What Was Built

Removed the `require('dotenv').config()` side effect from `src/pipeline-infra.js` (line 23), enforcing the principle that library modules must not re-load environment at import time. Entry points (CLI scripts, hook runners) are now solely responsible for calling `dotenv.config()`.

## Key Files

### Modified
- `src/pipeline-infra.js` — removed `require('dotenv').config()` call, added JSDoc explaining discipline
- `test/pipeline-infra.test.js` — added 2 dotenv discipline guard tests (no-call-at-require, exports check)
- `test/integration/semantic-search.test.js` — removed `jest.mock('dotenv', ...)` block and updated comments

## Test Results

- 62 pipeline-infra tests passing (including 2 new dotenv guards)
- 9 semantic-search integration tests passing (dotenv mock removed, no longer needed)
- Full suite: 1063 passing, 0 failures

## Deviations

None. Implementation matched plan exactly.

## Self-Check: PASSED
