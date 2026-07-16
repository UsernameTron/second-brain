# Phase 3: External Integrations - Discussion Log

**Date:** 2026-04-22
**Sessions:** 14-15
**Mode:** discuss (interactive, probe-first)
**Gray areas explored:** 4

## Gray Areas Presented

### Discussion Order (Pete-specified): 1 → 4 → 2 → 3

1. **Connector Approach** — Which transport per integration (Cowork native vs Docker MCP vs custom)
2. **Data Shaping and Filtering** — VIP lists, event filtering, repo scoping
3. **Error Handling and Degradation** — No-throw contract, retry policy, SCHED-02 alignment
4. **Composition Model** — How connectors integrate with existing codebase

User selected: All 4. Areas 2+3 discussed together per Pete's instruction.

## Discussion Summary

### Area 1: Connector Approach (D-01, D-04, D-11)

**Probe 1a:** Checked Cowork native Calendar tools via ToolSearch — found `mcp__claude_ai_Google_Calendar__*` family.
**Probe 1b:** Scheduling approach — hybrid (manual + session-start primary, headless cron deferred to Phase 4).
**Probe 1c:** Live verification — `list_calendars` returned Pete's actual calendars. Calendar connector is reachable from Claude Code terminal.
**Probe 1d:** Docker gmail-mcp found but uses IMAP/SMTP (send-capable). Rejected on zero-trust grounds.

**Decisions locked:**
- Calendar = Cowork native MCP (verified live)
- Calendar write-tool risk: application-layer read-only policy module required (D-02)
- Gmail = custom Node.js MCP server, standalone repo, OAuth `gmail.readonly` + `gmail.compose`
- Gmail server: exactly 3 tools, VIP filter baked in (D-08, D-09)
- OAuth: personal Google account, Testing mode consent screen, `~/.config/gmail-mcp/credentials.json` chmod 600
- GitHub = Docker MCP (already wired, no Phase 3 infra work)
- Scheduling = hybrid, cron syntax deferred to Phase 4

### Area 4: Composition Model (D-21, D-22)

**Q:** Extend `briefing-helpers.js` directly (A1) or new `src/connectors/` module (A2)?
**Recommendation:** A2 — clean separation, connector swap = one file change.
**A (Pete, Session 15):** A2 confirmed. New `src/connectors/` module: `calendar.js`, `gmail.js`, `github.js`. `briefing-helpers.js` stays focused on local pipeline state.

### Areas 2+3: Data Shaping and Error Handling (D-03, D-10, D-12, D-15 through D-20)

Discussed together per Pete's instruction. Pete provided four refinements that resolved both areas simultaneously:

**Refinement 1 — Contract enforcement (D-15):** Uniform return shape defined ONCE in `src/connectors/types.js`. Mandatory `{ success, data, error, source, fetchedAt }` shape. No connector throws — all errors caught and returned as `success: false`.

**Refinement 2 — Filtering in the connector (D-03, D-10, D-12):** For v1, `/today` is the only consumer. Build filtering into each connector:
- `getCalendarEvents(window)`: working-hours + declined-event filtering inside connector
- `getRecentEmails(window, vipOnly)`: VIP filter server-side AND connector-side (defense in depth)
- `getGitHubActivity(window)`: UsernameTron repo scoping inside connector
Don't pre-build for hypothetical reuse.

**Refinement 3 — Phase 3/4 boundary (D-16, D-22):** No `getAllBriefingData()` composite in Phase 3. `Promise.allSettled` fan-out belongs to `/today` in Phase 4. Documented explicitly.

**Refinement 4 — No LLM in connectors (D-17):** Connectors are pure data-fetching adapters. LLM summarization is Phase 4 composition. Keeps connector tests free of LLM mocks.

**Error handling (D-18, D-19, D-20):** No-throw contract, single attempt, no retries, no dead-letter for one-shot reads. Phase 2 dead-letter patterns don't apply — those preserve user-captured content, not external data fetches. SCHED-02 alignment verified: `success: false` shape maps directly to "degraded briefing with warnings."

**Test scope:** Per-connector test files with mocked transport. Integration tests in `test/integration-connectors.test.js` with SKIP-by-default flag.

## Decisions Made

22 decisions total (D-01 through D-22). See 03-CONTEXT.md for full decision record.

## Blockers

- Gemini CLI needs re-auth (`gemini auth login`) — flagged in sessions 4, 10, 11, 12, 13, 14. Required for cross-AI review before planning.
