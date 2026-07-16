---
phase: 06-defect-fixes-and-uat
plan: 02
status: complete
started: 2026-04-23
completed: 2026-04-23
---

# Plan 06-02 Summary: Remote Calendar MCP + Path Resolution

## What Was Built

### Task 1: Remote MCP connector for calendar (FIX-03)
- Added `REMOTE_TRIGGER` environment variable detection in `_fanOut()` of today-command.js
- Calendar connector receives `{ remote: true }` options when running in remote trigger context
- `getCalendarEvents()` in calendar.js handles dual-mode: local mcpClient vs remote MCP via `_remoteCallTool` injection
- Remote path uses same tool names and result envelope as local — transparent to callers
- Gmail and GitHub continue to degrade gracefully per D-02 (no changes needed)

### Task 2: Path resolution audit (FIX-05)
- Added `PROJECTS_DIR` and `VAULT_ROOT` environment variable overrides in today-command.js
- No hardcoded `/Users/cpconnor` paths found in `src/` (comment-only reference preserved)
- Slippage scanner and vault access paths resolve via env vars in remote environments

## Key Files

### Modified
- `src/today-command.js` — remote trigger detection, env var path overrides
- `src/connectors/calendar.js` — dual-mode (local/remote) calendar fetching
- `test/today-command.test.js` — remote trigger tests
- `test/connectors/calendar.test.js` — remote MCP path tests

## Verification
- `npx jest test/today-command.test.js test/connectors/calendar.test.js` — all pass
- `grep -rn '/Users/cpconnor' src/` — only comment reference (no hardcoded runtime paths)
- Full suite: 523 tests pass, 0 failures

## Deviations
- None
