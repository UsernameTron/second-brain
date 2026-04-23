# Phase 5: Integration Wiring - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning

<domain>
## Phase Boundary

The system runs unattended on real credentials and real data. Gmail OAuth wired (no stubs), RemoteTrigger firing on a real cron schedule, excluded terms expanded to 15-20 entries. No new features — this is wiring and configuration.

Requirements: INTEG-01, INTEG-02, INTEG-03

</domain>

<decisions>
## Implementation Decisions

### Gmail OAuth Bootstrap (D-01 through D-05)

- **D-01:** CLI setup script at `~/projects/gmail-mcp-pete/scripts/auth.js`. Runs once, opens browser for Google OAuth consent, handles localhost callback, stores refresh token in macOS Keychain via `keytar`. Standard Google OAuth2 desktop/installed-app flow. Uses existing `credentials.json` (client_id/client_secret already present).

- **D-02:** Token refresh is automatic. The `googleapis` OAuth2 client handles refresh natively — set credentials on the client, it refreshes when expired. On successful refresh, store the new refresh token back to Keychain via `keytar`. No manual token management.

- **D-03:** No fail-fast on token refresh failure. If refresh fails (expired, revoked, network), the gmail-mcp-pete tools return error responses. The second-brain Gmail connector catches these per the no-throw contract (Phase 3 D-18) and returns `{success: false}`. The `/today` briefing degrades gracefully on the Gmail section (Phase 4 D-10/D-11). No special handling needed.

- **D-04:** Wire all three stub functions in `gmail-mcp-pete/src/tools.js` to real googleapis calls:
  - `listRecentMessages` → `gmail.users.messages.list` with `gmail.readonly` scope. Apply `allowedSenders` as Gmail query filter (`from:addr1 OR from:addr2`).
  - `getMessageBody` → `gmail.users.messages.get` with `gmail.readonly` scope. Return decoded body text.
  - `createDraft` → `gmail.users.drafts.create` with `gmail.compose` scope. Never use `gmail.send`.

- **D-05:** OAuth scopes remain exactly `gmail.readonly` + `gmail.compose` per Phase 3 D-05. Testing-mode consent screen per Phase 3 D-07 — no Google review required.

### Excluded Terms Expansion (D-06 through D-08)

- **D-06:** Matching strategy: **substring, case-insensitive.** No regex — overkill for a personal blocklist. A capture containing "genesys" anywhere in the text (regardless of case) is filtered. This applies to the existing ingress filter in `/new`.

- **D-07:** Target: 15-20 entries in `config/excluded-terms.json`. Categories: former employer product names, former employer company names, former project codenames, former client names, former internal tool names. Exact strings provided by user during execution — planner should create a task that includes user-provided terms as input.

- **D-08:** Verify existing ingress filter supports substring + case-insensitive matching. If the current implementation is exact-match, update to substring + case-insensitive. The filter touches `/new` classification and potentially the memory promotion pipeline.

### RemoteTrigger Activation (D-09 through D-12)

- **D-09:** Verification approach: enable the trigger, observe one scheduled fire, confirm output in vault daily note, then leave it on. No elaborate test harness.

- **D-10:** DST handling: accept UTC cron with local-time shift twice a year. Manual cron update (`45 11` CDT ↔ `45 12` CST) is acceptable — two edits per year. Config in `config/scheduling.json` already documents this.

- **D-11:** RemoteTrigger **cannot reach gmail-mcp-pete** (local stdio MCP server). RemoteTrigger runs in Anthropic's cloud with no access to local machine. The `/today` command will degrade gracefully on the Gmail section when running via RemoteTrigger (null mcpClient → `{success: false}` → degraded section). Live Gmail data only available when running locally in Claude Code. This is acceptable for v1.1 — RemoteTrigger still delivers calendar, GitHub, vault pipeline, and slippage sections.

- **D-12:** Delete test trigger `trig_01NHx3Uz8ni8eZSfsMph4miY` before creating the real trigger. Create real trigger per `config/scheduling.json` spec. Start with `enabled: false`, verify config, then enable.

### Claude's Discretion

- Token storage key names in Keychain (service/account naming convention)
- Gmail query syntax for `allowedSenders` filter optimization
- Error message format from gmail-mcp-pete tools (should align with Phase 3 D-10 grep-friendly format)
- Whether to add an `hours` parameter to `list_recent_messages` tool schema (currently missing from stub — present in second-brain connector interface)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Gmail OAuth (gmail-mcp-pete repo)
- `~/projects/gmail-mcp-pete/src/tools.js` — Current stubs to be replaced with real googleapis calls
- `~/projects/gmail-mcp-pete/src/index.js` — MCP server entry point, tool schemas
- `~/projects/gmail-mcp-pete/credentials.json` — Google Cloud OAuth client config (installed app)
- `~/projects/gmail-mcp-pete/package.json` — Dependencies: googleapis, keytar, @modelcontextprotocol/sdk

### Gmail Connector (second-brain repo)
- `src/connectors/gmail.js` — Connector wrapping gmail-mcp-pete, VIP filtering, mcpClient DI
- `src/connectors/types.js` — SOURCE enum, makeResult/makeError, uniform return shape (Phase 3 D-15)

### Excluded Terms
- `config/excluded-terms.json` — Current 3-entry blocklist to expand to 15-20
- `src/classify.js` or equivalent — Ingress filter that consumes excluded terms (verify location)

### RemoteTrigger
- `config/scheduling.json` — Full trigger spec (name, schedule, model, environment_id, mcp_connections)

### Phase 3 Connector Contract
- `.planning/phases/03-external-integrations/03-CONTEXT.md` — D-04 through D-10 (Gmail architecture), D-15 through D-18 (uniform shape, no-throw)

### Phase 4 Degradation Design
- `.planning/phases/04-daily-briefing-and-scheduling/04-CONTEXT.md` — D-10/D-11 (degradation format), D-16 through D-18 (RemoteTrigger config), D-20 through D-22 (Gmail scope boundary)

### Project Governance
- `.planning/PROJECT.md` — Zero-trust posture, key decisions, known gaps
- `.planning/REQUIREMENTS.md` — INTEG-01, INTEG-02, INTEG-03 acceptance criteria

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `gmail-mcp-pete/src/index.js` — MCP server scaffold already working, just needs real tool implementations
- `gmail-mcp-pete/credentials.json` — OAuth client config ready to use
- `src/connectors/gmail.js` — Connector-side code needs zero changes (mcpClient DI pattern)
- `config/scheduling.json` — Complete RemoteTrigger config, ready to deploy via API
- `config/excluded-terms.json` — Existing mechanism, just needs more entries

### Established Patterns
- No-throw contract on all connectors (Phase 3 D-18)
- mcpClient dependency injection in connectors and today-command
- Keychain via keytar for credential storage (Phase 3 D-06)
- Config + JSON Schema validation (`config/*.json` + `config/schema/*.schema.json`)
- Graceful degradation when sources fail (Phase 4 D-10/D-11)

### Integration Points
- `gmail-mcp-pete/src/tools.js` — Replace three stubs with googleapis calls + Keychain auth
- `gmail-mcp-pete/scripts/auth.js` — New one-time setup script
- `config/excluded-terms.json` — Expand entries
- RemoteTrigger API — Create and enable trigger
- Ingress filter — Verify/update to substring + case-insensitive matching

</code_context>

<specifics>
## Specific Ideas

- Gmail section in `/today` will show degraded when running via RemoteTrigger (cloud) — this is by design, not a bug
- Excluded terms list will be provided by user during execution — planner should structure the task to accept user input
- Test trigger deletion is a manual step (web UI at claude.ai/code/scheduled) — include as a human checkpoint in the plan

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-integration-wiring*
*Context gathered: 2026-04-22*
