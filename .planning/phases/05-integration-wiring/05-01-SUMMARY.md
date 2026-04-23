---
phase: 05-integration-wiring
plan: 01
subsystem: auth
tags: [googleapis, keytar, oauth2, gmail, mcp, keychain]

# Dependency graph
requires:
  - phase: 03-connectors
    provides: gmail.js connector that calls MCP tool functions

provides:
  - OAuth2 bootstrap script (scripts/auth.js) for one-time keychain setup
  - Shared auth module (src/auth-helper.js) with typed AUTH_ERRORS constants
  - Real googleapis calls in tools.js replacing all three stubs
  - Typed error classification: AUTH_REQUIRED, TOKEN_REFRESH_FAILED, PERMISSION_DENIED
  - Multipart MIME parsing with text/plain preference and HTML fallback

affects: [05-02, 05-03, second-brain/today-command, second-brain/gmail-connector]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Typed auth error taxonomy: AUTH_ERRORS constants + classifyError() mapper"
    - "MIME priority chain: text/plain > text/html-stripped > single-part > none with bodySource indicator"
    - "Base64url decode/encode with RFC 2822 message building for Gmail draft creation"
    - "Keychain-backed OAuth2 with googleapis auto-refresh — no token management in runtime code"

key-files:
  created:
    - ~/projects/gmail-mcp-pete/src/auth-helper.js
    - ~/projects/gmail-mcp-pete/scripts/auth.js
  modified:
    - ~/projects/gmail-mcp-pete/src/tools.js
    - ~/projects/gmail-mcp-pete/src/index.js

key-decisions:
  - "AUTH_ERRORS constants exported from auth-helper, not inline strings — consumers compare errorType field not string patterns"
  - "classifyError() maps googleapis HTTP codes (401, 403) and error message patterns to typed codes — single mapping point"
  - "getMessageBody returns bodySource field ('text/plain', 'text/html-stripped', 'none') so consumer knows content quality"
  - "messages.send never appears as a function call — comment-only reference documents the constraint explicitly"

patterns-established:
  - "classifyError pattern: centralized googleapis error → typed code mapping, not per-function string matching"
  - "MIME parsing chain: recursive part search, priority by type, graceful empty fallback with source annotation"

requirements-completed: [INTEG-01]

# Metrics
duration: 25min
completed: 2026-04-23
---

# Phase 05 Plan 01: Gmail MCP OAuth Wiring Summary

**googleapis live calls with Keychain-backed OAuth2, typed AUTH_ERRORS taxonomy, and multipart MIME body parsing replacing all three stubs in gmail-mcp-pete**

## Performance

- **Duration:** ~25 min (automated) + user OAuth bootstrap
- **Started:** 2026-04-23
- **Completed:** 2026-04-23
- **Tasks:** 3/3 complete
- **Files modified:** 4

## Accomplishments
- Created `src/auth-helper.js` with `getAuthenticatedClient()`, `getOAuth2Client()`, `SCOPES`, and `AUTH_ERRORS` constants
- Created `scripts/auth.js` one-time OAuth bootstrap script with readline stdin, keytar Keychain storage, and full error handling
- Replaced all three stub tool functions with live googleapis calls: `gmail.users.messages.list`, `gmail.users.messages.get`, `gmail.users.drafts.create`
- Implemented `classifyError()` mapping googleapis errors to typed `AUTH_REQUIRED`/`TOKEN_REFRESH_FAILED`/`PERMISSION_DENIED` codes
- Implemented recursive MIME parsing in `getMessageBody`: text/plain preferred, HTML with tag stripping as fallback, `bodySource` field in response
- Added `hours` parameter to `list_recent_messages` tool schema in `index.js` (connector passes this — was missing from schema)
- Zero `gmail.send` calls anywhere in the codebase

## Task Commits

1. **Task 1: Create OAuth bootstrap script and auth helper module** - `e873ade` (feat) — already committed prior to this execution
2. **Task 2: Wire tools.js stubs to real googleapis calls** - `e4d1971` (feat)
3. **Task 3: Run OAuth bootstrap and verify live Gmail data** - Completed by user (checkpoint:human-action)

## Files Created/Modified
- `~/projects/gmail-mcp-pete/src/auth-helper.js` — OAuth2 client factory, Keychain-backed auth, AUTH_ERRORS constants
- `~/projects/gmail-mcp-pete/scripts/auth.js` — One-time CLI OAuth bootstrap: URL generation, code exchange, Keychain storage
- `~/projects/gmail-mcp-pete/src/tools.js` — Real googleapis calls replacing all stubs, classifyError(), MIME parsing
- `~/projects/gmail-mcp-pete/src/index.js` — Added `hours` property to list_recent_messages tool schema

## Decisions Made
- AUTH_ERRORS exported as constants from auth-helper (not inline strings) so consumers compare `errorType` field structurally
- `classifyError()` is a single central mapping function covering HTTP codes (401→TOKEN_REFRESH_FAILED, 403→PERMISSION_DENIED) and error message patterns — avoids duplicated string matching across three functions
- `bodySource` field added to `getMessageBody` response so the second-brain gmail connector knows what quality of content it received
- The string `gmail.users.messages.send` appears only in a comment explicitly documenting the constraint — no call path exists

## Deviations from Plan

None — plan executed exactly as written. Task 1 files were already present from a prior session commit; verified against acceptance criteria before proceeding.

## Issues Encountered
- Task 1 files (`auth-helper.js`, `scripts/auth.js`) were already committed (`e873ade`) from a prior execution session. Verified both files against all acceptance criteria — they passed. No re-work needed.

## User Setup Required

OAuth bootstrap completed during execution:
- Refresh token stored in macOS Keychain
- listRecentMessages verified with live Gmail data (3 messages — Reddit, statuspage.io)
- MCP response shape confirmed correct

## Next Phase Readiness
- INTEG-01 fully satisfied — gmail-mcp-pete returns live Gmail data through OAuth
- second-brain gmail connector can use live data for /today briefing
- Auth error taxonomy enables actionable diagnostics if token expires

---
*Phase: 05-integration-wiring*
*Plan: 01*
*Completed: 2026-04-23*

## Self-Check: PASSED

**Files verified:**
- FOUND: /Users/cpconnor/projects/gmail-mcp-pete/src/auth-helper.js
- FOUND: /Users/cpconnor/projects/gmail-mcp-pete/scripts/auth.js
- FOUND: /Users/cpconnor/projects/gmail-mcp-pete/src/tools.js (modified)
- FOUND: /Users/cpconnor/projects/gmail-mcp-pete/src/index.js (modified)

**Commits verified:**
- FOUND: e873ade (feat(05-01): add OAuth auth helper and bootstrap script)
- FOUND: e4d1971 (feat(05-01): wire tools.js stubs to real googleapis calls)

**Module load test:** Both `require('./src/auth-helper')` and `require('./src/tools')` exit 0.

**No gmail.send calls:** Verified — only appears in comment.

**No stub:true:** Verified — zero occurrences in tools.js.

**AUTH error taxonomy:** 4 occurrences of classifyError/AUTH_ERRORS/errorType pattern, 7 errorType references in catch blocks.
