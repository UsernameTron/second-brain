---
phase: 03-external-integrations
plan: "03"
subsystem: connectors/gmail
tags: [gmail, mcp, connector, vip-filter, security]
dependency_graph:
  requires: [03-01]
  provides: [src/connectors/gmail.js, Gmail connector public API]
  affects: [03-04, Phase 4 /today command]
tech_stack:
  added: []
  patterns: [dependency-injection-mcp-client, two-layer-vip-filter, no-throw-contract, tdd]
key_files:
  created:
    - src/connectors/gmail.js
    - test/connectors/gmail.test.js
  modified:
    - test/connectors/helpers.js
decisions:
  - "Two-layer VIP filtering: server-side (allowedSenders param) + connector-side (case-insensitive substring match) per D-09/D-10"
  - "No-throw contract: all error paths return makeError, none throw, per D-18"
  - "Export surface limited to getRecentEmails/getEmailBody/createDraft — no send verbs per D-05/D-08"
  - "Lazy memoized config with _config module-level var to respect CONFIG_DIR_OVERRIDE in tests"
metrics:
  duration: "~10 minutes"
  completed: "2026-04-22T20:53:33Z"
  tasks_completed: 1
  files_created: 2
  files_modified: 1
  tests_added: 28
---

# Phase 03 Plan 03: Gmail Connector Summary

Gmail connector with two-layer VIP filtering, draft-only write, and D-15 uniform return shape — zero send-verb exports, no-throw contract, 28 tests passing.

## Objective

Build `src/connectors/gmail.js` that wraps the `gmail-mcp-pete` MCP server's three tools (`list_recent_messages`, `get_message_body`, `create_draft`) with connector-side VIP filtering and the D-15 uniform return shape. Satisfies INTG-01.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Gmail connector with VIP filtering and draft-only write | 3ec2ba7 | src/connectors/gmail.js, test/connectors/gmail.test.js, test/connectors/helpers.js |

## Decisions Made

1. **Two-layer VIP filtering architecture (D-09 + D-10):** Layer 1 passes `config.vipSenders` as `allowedSenders` to the MCP server — trust-boundary enforcement, payload reduction, and protection for future consumers of `gmail-mcp-pete`. Layer 2 applies connector-side case-insensitive filter after receiving the response — project-specific VIP policy from `config/connectors.json`. The server list is a superset; the connector enforces the project-specific subset.

2. **Lazy memoized `_getConfig()`:** Module-level `let _config = null` with lazy load ensures `CONFIG_DIR_OVERRIDE` env var (set in test `beforeAll`) takes effect at call time, not at module load time. Same pattern as `getConnectorsConfig()` in types.js.

3. **`_isVipSender` helper handles "Display Name <email>" format:** Extracts angle-bracket portion when present, falls back to raw string. Enables robust matching even when Gmail includes display names.

4. **No-throw contract (D-18):** Every exported function wraps MCP calls in try/catch and returns `makeError(SOURCE.GMAIL, ...)` on failure. Guards on `mcpClient`, `messageId`, `to/subject` return error shapes without attempting MCP calls.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed two-argument `expect()` in helpers.js incompatible with expect@30**

- **Found during:** Task 1 — GREEN phase
- **Issue:** `test/connectors/helpers.js` used `expect(boolean, 'message').toBe(true)` — a Jest 27 pattern not supported in expect@30 ("Expect takes at most one argument"). This blocked all connector tests using the shared helpers.
- **Fix:** Replaced three occurrences with single-argument `expect(boolean).toBe(true)` plus inline comment. The message was diagnostic-only (not part of assertions) so no test semantics were changed.
- **Files modified:** `test/connectors/helpers.js`
- **Commit:** 3ec2ba7 (included in task commit)
- **Side effect:** Also unblocked `test/connectors/calendar.test.js` and `test/connectors/github.test.js` (previously failing for the same reason). All 113 connector tests now pass.

## Verification

```
npx jest test/connectors/gmail.test.js --verbose
Test Suites: 1 passed, 1 total
Tests:       28 passed, 28 total
```

Full connector suite:
```
npx jest test/connectors/ --verbose
Test Suites: 4 passed, 4 total
Tests:       113 passed, 113 total
```

## Acceptance Criteria Status

- [x] `src/connectors/gmail.js` contains `const { SOURCE, makeResult, makeError, loadConnectorsConfig } = require('./types')`
- [x] `src/connectors/gmail.js` contains `module.exports = { getRecentEmails, getEmailBody, createDraft }`
- [x] `src/connectors/gmail.js` does NOT contain `send` in any function name or MCP tool call string
- [x] `src/connectors/gmail.js` contains `config.vipSenders` filtering logic
- [x] `src/connectors/gmail.js` contains `makeError(SOURCE.GMAIL` (no-throw contract)
- [x] `test/connectors/gmail.test.js` contains `assertSuccessShape` and `assertErrorShape` calls
- [x] `test/connectors/gmail.test.js` contains `exports no send functions` test
- [x] `test/connectors/gmail.test.js` contains VIP subset contract test
- [x] All 28 tests pass

## Self-Check: PASSED
