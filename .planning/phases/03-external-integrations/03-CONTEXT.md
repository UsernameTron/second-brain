# Phase 3: External Integrations - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Gmail, Google Calendar, and GitHub data accessible to Claude Code through MCP connectors operating at minimum viable permissions. Each connector is a thin, individually-callable async adapter that returns a uniform result shape. Connectors do NOT compose into a composite fetch — that fan-out belongs to `/today` in Phase 4.

Requirements: INTG-01, INTG-02, INTG-03

</domain>

<traceability>
## Requirements Traceability

| Requirement | Description | Satisfied By |
|-------------|-------------|-------------|
| INTG-01 | Gmail MCP connector with draft-only permission and VIP sender filtering | D-04, D-05, D-06, D-07, D-08, D-09, D-10, D-15, D-16, D-17, D-20, D-23 |
| INTG-02 | Google Calendar MCP connector with read-only permission | D-01, D-02, D-03, D-15, D-16, D-17, D-20, D-23 |
| INTG-03 | GitHub MCP connector scoped to UsernameTron repos | D-11, D-12, D-15, D-16, D-17, D-20, D-23 |

</traceability>

<decisions>
## Implementation Decisions

### Calendar Connector (D-01 through D-03)

- **D-01:** Calendar connector uses Cowork native MCP tools (`mcp__claude_ai_Google_Calendar__*`). Already live in Claude Code — verified via `list_calendars` probe returning Pete's calendars.
- **D-02:** Read-only enforcement by API omission. The Cowork native Calendar MCP exposes create/update/delete tools at the MCP layer, but the second-brain connector's public API exposes only two functions: `getCalendarEvents(window)` and `getEvent(id)`. There is no separate "policy module" — the connector module itself is the enforcement boundary. It does not import or reference any write-capable MCP tool. A contract test asserts the connector's exported surface contains no write verbs (`create*`, `update*`, `delete*`, `patch*`). If a future change needs write access, it requires a deliberate new export — not a config flag.
- **D-03:** `getCalendarEvents(window)` applies filtering inside the connector:
  - Working-hours filter: exclude events outside configured working hours
  - Declined-event filter: exclude events where Pete's response is "declined"
  - Returns only events within the requested time window

### Gmail Connector (D-04 through D-10)

- **D-04:** Gmail connector is a custom Node.js MCP server in a standalone repo (not inside second-brain). Decoupled lifecycle — Gmail server evolves independently.
- **D-05:** OAuth scopes: `gmail.readonly` + `gmail.compose` only. `gmail.send` is never requested. Enforcement at OAuth consent screen level — the token physically cannot send.
- **D-06:** OAuth credentials stored in macOS Keychain via the `keytar` npm package. Service name: `gmail-mcp-pete`; account: Pete's Google email. Refresh token and access token are separate Keychain entries. **No plaintext credential files on disk.** Threat model: defends against malware running as Pete (Keychain requires app entitlement or user unlock) and against malicious npm dependencies reading `~/.config/`. Fallback if `keytar` fails to load: fail-fast at startup with a clear error — never silently degrade to plaintext. OAuth client config (non-secret `client_id`, `client_secret` per Google's OAuth model for installed apps) remains in a separate file at `~/.config/gmail-mcp/client.json`, chmod 600 — these values are treated as public-ish per Google's installed-app guidance and are NOT the session credentials.
- **D-07:** OAuth client: Pete's personal Google account. Testing mode consent screen (not published — no Google review required).
- **D-08:** Gmail server exposes exactly 3 tools: `list_recent_messages`, `get_message_body`, `create_draft`. No search, no label management, no send.
- **D-09:** Server-side VIP filter in the Gmail MCP server. Not caller-toggleable. Purpose is payload reduction and trust-boundary enforcement — `gmail-mcp-pete` is a standalone repo with its own lifecycle and may be reused by consumers other than second-brain, so the server enforces a hard ceiling on what leaves it. Default VIP list ships with the server; second-brain overrides via the allowed-senders argument on `list_recent_messages`.
- **D-10:** `getRecentEmails(window, vipOnly)` applies a second VIP filter inside the second-brain connector. This is not redundant — the two layers serve different threat models:
  - **Server-side (D-09):** bound what an untrusted-boundary process returns, minimize data crossing the process boundary, protect any future consumer.
  - **Connector-side (D-10):** apply second-brain's specific VIP policy from `config/connectors.json` (D-23). The connector is the source of truth for which senders count as VIP for *this* project. The server-side filter is a superset; the connector-side filter is the project-specific subset.

  A contract test asserts that the connector's output is always a subset of what the server returns. If the two lists ever diverge (e.g., someone added a sender to server default but not to `config/connectors.json`), the connector filter wins.

### GitHub Connector (D-11 through D-12)

- **D-11:** GitHub connector uses Docker MCP (`mcp__MCP_DOCKER__*`). Already wired — no Phase 3 infrastructure work needed.
- **D-12:** `getGitHubActivity(window)` scopes to UsernameTron repos only inside the connector. No consumer-side repo filtering.

### Scheduling (D-13 through D-14)

- **D-13:** Scheduling is hybrid: manual invocation + session-start hook primary. Headless cron via `ccdScheduledTasksEnabled` deferred to Phase 4 research.
- **D-14:** `ccdScheduledTasksEnabled` recurrence syntax unverified. Deferred to Phase 4 — not a Phase 3 deliverable.

### Connector Contract (D-15 through D-17)

- **D-15:** Uniform return shape defined in `src/connectors/types.js`. The `source` field uses exported constants — never bare string literals — to prevent typos and give consumers a typed reference:
  ```js
  export const SOURCE = Object.freeze({
    CALENDAR: 'calendar',
    GMAIL: 'gmail',
    GITHUB: 'github',
  });
  ```
  Shape:
  ```
  { success: true,  data: <connector-specific>, error: null,  source: SOURCE.*, fetchedAt: ISO8601 }
  { success: false, data: null,                 error: "<human-readable reason>", source: SOURCE.*, fetchedAt: ISO8601 }
  ```
  No connector returns a different shape. No connector throws — all errors caught and returned as `success: false`. Contract test asserts every returned `source` value is a member of the `SOURCE` enum.
- **D-16:** Connectors are individually-callable, async, safe to call concurrently via `Promise.allSettled`. No `getAllBriefingData()` composite in Phase 3. The fan-out belongs to `/today` in Phase 4.
- **D-17:** Connectors do not invoke the LLM client. They are pure data-fetching adapters. LLM-summarized briefing content is Phase 4 composition between connector output and presentation. This keeps connector tests free of LLM mocks.

### Error Handling (D-18 through D-20)

- **D-18:** No-throw contract: every connector catches all errors internally and returns `{ success: false, ... }`. Callers never need try/catch around connector calls.
- **D-19:** Single attempt per connector call. No retries, no dead-letter queue. One-shot reads have nothing to dead-letter into. Phase 2's dead-letter patterns (D-35 through D-39) do not apply to connector reads — those patterns are for preserving user-captured content that failed routing.
- **D-20:** SCHED-02 alignment verified. Phase 4's "degraded briefing with warnings" maps directly to the `success: false` return shape. `/today` checks each connector result; if `success: false`, surfaces the `error` field as a warning line in that briefing section and continues with available data.

### Composition Model (D-21)

- **D-21:** New `src/connectors/` module with three files: `calendar.js`, `gmail.js`, `github.js`. `briefing-helpers.js` stays focused on local pipeline state (vault scans, dead-letter, proposals). Connectors handle external service data fetching. Clean separation — connector swap (e.g., Calendar from Cowork native to custom MCP) is a single-file change.

### Phase 3/4 Boundary (D-22)

- **D-22:** Explicit boundary: Phase 3 delivers individually-callable connectors with uniform return shapes. Phase 4 composes them via `Promise.allSettled` fan-out in `/today`, adds LLM summarization, builds the 6-section briefing format, and handles presentation. No half-built composite should exist at Phase 3 ship waiting for Phase 4 to complete.

### Connector Config Location (D-23)

- **D-23:** All connector-specific runtime config lives in `config/connectors.json`, validated at boot against `config/schema/connectors.schema.json`. This is the home for:
  - Calendar: working-hours window (D-03), declined-event filter rules
  - Gmail: VIP sender list (D-09, D-10), time window defaults
  - GitHub: repo allowlist (D-12), event-type filters

  Pattern matches existing `config/pipeline.json` + `config/schema/` convention — no new config infrastructure. Connectors load this file once at module init via existing config loader. Schema-validation failure is fail-fast: the process exits with a descriptive error. Secrets never go in this file — credentials are in Keychain (D-06), the non-secret OAuth client config is in `~/.config/gmail-mcp/client.json`. `config/connectors.json` is safe to commit.

</decisions>

<testing>
## Test Strategy

### Unit Tests (per connector)
- `test/connectors/calendar.test.js` — mocked Cowork MCP transport, tests filtering logic, error wrapping, return shape
- `test/connectors/gmail.test.js` — mocked Gmail MCP transport, tests VIP filtering, error wrapping, return shape
- `test/connectors/github.test.js` — mocked Docker MCP transport, tests repo scoping, error wrapping, return shape

### Contract Tests
- Every test file validates the uniform return shape (D-15) for both success and failure paths
- Shape assertion: `{ success, data, error, source, fetchedAt }` — no extra fields, no missing fields

### Integration Tests
- `test/integration-connectors.test.js` — hits live MCP servers
- SKIP-by-default flag (`INTEGRATION=true` env var to enable)
- Not in CI — run manually before phase ship
- Tests: connector reaches live service, returns valid shape, filtering works against real data

</testing>

<upstream>
## Upstream Dependencies

### From Phase 1 (Vault Foundation)
- Write-gateway for any vault writes (connectors are read-focused but Gmail `create_draft` may write)
- Ingress filter for any content that flows through connectors into vault

### From Phase 2 (Content Pipeline)
- `briefing-helpers.js` — connectors integrate alongside existing local pipeline helpers
- Config infrastructure (`config/` + `config/schema/`) — connector-specific runtime config lives in new `config/connectors.json` validated against `config/schema/connectors.schema.json`, following the existing `pipeline.json` pattern (D-23)

### Phase 4 Downstream Contract
- Phase 4 expects: three async functions, each returning the D-15 shape
- Phase 4 handles: `Promise.allSettled` fan-out, LLM summarization, presentation, SCHED-02 degradation

</upstream>
