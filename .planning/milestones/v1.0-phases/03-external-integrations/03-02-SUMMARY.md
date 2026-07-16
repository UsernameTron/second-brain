---
phase: 03-external-integrations
plan: 02
subsystem: connectors/calendar
tags: [calendar, mcp, filtering, tdd, read-only]
dependency_graph:
  requires: [03-01]
  provides: [src/connectors/calendar.js]
  affects: [Phase 4 /today fan-out composition]
tech_stack:
  added: []
  patterns: [dependency-injection-mcp-client, tdd-red-green, no-throw-contract]
key_files:
  created:
    - src/connectors/calendar.js
    - test/connectors/calendar.test.js
  modified:
    - test/connectors/helpers.js
decisions:
  - "D-01: mcpClient injected as parameter — tests mock it, production /today passes real transport"
  - "D-02: Read-only by API omission — only getCalendarEvents/getEvent exported, contract test enforces no write verbs"
  - "D-03: Filtering in connector layer — declined (case-insensitive email) and working-hours (local timezone via Intl.DateTimeFormat)"
  - "D-15: Uniform result shape via makeResult/makeError from types.js — SOURCE.CALENDAR on all paths"
  - "D-18: No-throw contract — all errors caught and returned as {success: false}"
metrics:
  duration_minutes: 3
  completed_date: "2026-04-22"
  tasks_completed: 1
  files_created: 2
  files_modified: 1
  tests_added: 32
---

# Phase 3 Plan 2: Google Calendar Connector Summary

Google Calendar connector with dependency-injected MCP transport, working-hours + declined-event filtering, and strict read-only export surface enforced by contract test.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests for calendar connector | bcd20d7 | test/connectors/calendar.test.js |
| 1 (GREEN) | Calendar connector implementation | 2831472 | src/connectors/calendar.js, test/connectors/helpers.js |

## What Was Built

### `src/connectors/calendar.js`

Two exported async functions, both read-only per D-02:

**`getCalendarEvents(mcpClient, options)`**
- Guards: returns `{success: false}` immediately if `mcpClient` is falsy
- Computes `timeMin`/`timeMax` from `options.hours` (or `config.defaultWindowHours`)
- Calls `mcpClient.callTool('list_calendar_events', { timeMin, timeMax })`
- Applies two filters via `_filterEvents()`:
  1. Declined filter: removes events where Pete's attendee `responseStatus === 'declined'`. Email matched case-insensitively against `config.userEmail`
  2. Working-hours filter: parses `start.dateTime` hour in configured IANA timezone (via `Intl.DateTimeFormat`). All-day events (`start.date` only) bypass this filter
- Returns `makeResult(SOURCE.CALENDAR, { events: filteredEvents })`
- Catches all errors → returns `makeError(SOURCE.CALENDAR, message)`

**`getEvent(mcpClient, eventId)`**
- Guards for both `mcpClient` and `eventId`
- Calls `mcpClient.callTool('get_calendar_event', { eventId })`
- Returns `makeResult(SOURCE.CALENDAR, { event })`
- Catches all errors → returns `makeError(SOURCE.CALENDAR, message)`

### `test/connectors/calendar.test.js`

32 tests across 3 describe blocks:
- `getCalendarEvents`: 21 tests — guards, error wrapping, filtering (declined/hours/all-day), case-insensitive email, default window, source field, result shape contract
- `getEvent`: 8 tests — guards, success path, error path, MCP tool call verification, result shape contract
- `D-02 contract`: 2 tests — no write-verb exports, exact export surface

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed helpers.js two-argument expect() incompatible with Jest 30**

- **Found during:** TDD GREEN phase — 13 tests failed with "Expect takes at most one argument"
- **Issue:** `test/connectors/helpers.js` (from 03-01) used `expect(value, message).toBe(true)` — a Jest API that was removed in Jest 29+. Project uses Jest 30.3.0.
- **Fix:** Removed second argument from all three `expect()` calls in `assertSuccessShape`, `assertErrorShape`, and `assertSourceEnum`. The source value is still visible in Jest's diff output on failure.
- **Files modified:** `test/connectors/helpers.js`
- **Note:** The file was also being fixed in parallel by a linter before the manual edit — final state is correct.

## Known Stubs

None. Both functions are fully wired: MCP calls, filtering, and uniform result shapes are complete. No placeholder data or TODO markers.

## Self-Check: PASSED

- [x] `src/connectors/calendar.js` exists at expected path
- [x] `test/connectors/calendar.test.js` exists at expected path
- [x] Commit bcd20d7 exists (failing tests — RED)
- [x] Commit 2831472 exists (implementation — GREEN)
- [x] All 32 tests pass: `npx jest test/connectors/calendar.test.js` → 32 passed, 0 failed
- [x] No write-verb exports (D-02 contract test passes)
- [x] `loadConnectorsConfig` used (not `getConnectorsConfig`) — config loaded fresh per call, respects `CONFIG_DIR_OVERRIDE`
- [x] All return paths use `SOURCE.CALENDAR`
- [x] No stubs, no TODO markers, no throw statements in public API
