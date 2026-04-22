---
phase: 3
reviewers: [gemini, codex]
reviewed_at: "2026-04-22T18:00:00Z"
plans_reviewed: [03-01-PLAN.md, 03-02-PLAN.md, 03-03-PLAN.md, 03-04-PLAN.md]
gate_recommendation: PATCH-THEN-PROCEED
---

# Cross-AI Plan Review — Phase 3

## Gemini Review

### Summary
This is a comprehensive and well-architected plan for Phase 3. The breakdown into a foundational wave for shared infrastructure followed by parallel waves for connector implementation is sound and efficient. The plans demonstrate a mature approach, prioritizing security, testability, and a consistent developer contract. The zero-trust posture is not just a stated goal but is reflected in concrete design decisions and verification steps (e.g., "no-send" contract tests). The overall design sets a strong foundation for future composition in Phase 4.

### Strengths
- **Security-First Design:** The principle of least privilege is expertly applied, from the read-only/draft-only API scopes to the contract tests that programmatically enforce these boundaries. The two-layer VIP filtering for Gmail is a particularly strong design, correctly separating security policy at the trust boundary from application-specific policy in the connector.
- **Robust Connector Contract:** Plan 03-01 establishes a uniform, predictable contract (makeResult/makeError, SOURCE enum, no-throw guarantee). This is a critical investment that will simplify integration, testing, and error handling in Phase 4.
- **High Testability:** The commitment to TDD, dependency injection of mcpClient, and the creation of shared test helpers (assertSuccessShape, assertErrorShape) will produce a reliable and maintainable codebase.
- **Clear Phasing & Scope:** The plans are well-scoped with a clean boundary between Phase 3 (building the connectors) and Phase 4 (composing them). This focus prevents scope creep and ensures the delivery of discrete, valuable components.

### Concerns
- **MEDIUM: Unspecified Credential Handling:** The plan for the Gmail connector is explicit about using keytar for credential storage, but the plans for the Calendar and GitHub connectors omit this critical detail. How will the application securely access the credentials for their respective MCPs?
- **MEDIUM: Ambiguous Pagination Strategy:** Connectors fetching lists of resources (getCalendarEvents, getRecentEmails, getGitHubActivity) do not specify how they will handle paginated API responses. This could lead to silently incomplete data.
- **LOW: Missing Rate Limit Strategy:** The plans do not mention how connectors will respond to API rate-limiting errors (e.g., HTTP 429). While the "no-retry" policy is clear, these errors should be identified and propagated with a distinct error type for Phase 4.
- **LOW: Config Loading Pattern:** The plan implies a module-level load for connectors.json. For the current use case (CLI/scripting), this is acceptable (fail-fast). However, this decision should be explicit.

### Suggestions
- Document all credential paths for 03-02 and 03-04.
- Define explicit pagination policies per connector.
- Standardize error shapes with machine-readable errorCode.
- Add explicit test specs for filtering logic.

### Risk Assessment: LOW
### Gate Recommendation: PATCH-THEN-PROCEED

---

## Codex Review

### Summary
The Phase 3 plan set is mostly well-shaped: the wave ordering is sensible, the connector boundary is clean, the Phase 3/4 split is disciplined, and the uniform no-throw contract is a strong foundation for /today. The main problem is not architecture, it is execution fidelity. As written, the plans likely miss part of INTG-01 and may fail INTG-03 outright because the Gmail plan does not implement the documented server-side VIP override path, and the GitHub plan assumes a `list_user_events` tool surface that is not present in the current MCP_DOCKER capability set. The config/schema story is also weaker than the plans claim.

### Strengths
- Wave sequencing is correct: shared connector contract first, service connectors second.
- The Phase 3/4 boundary is clean. No premature composite fetcher.
- mcpClient dependency injection is the right testability seam.
- The uniform {success, data, error, source, fetchedAt} contract is a strong choice.
- The zero-trust posture is explicit instead of implied.
- The two-layer VIP model is conceptually sound, not redundant.

### Concerns
- **HIGH: GitHub tool surface mismatch.** 03-04-PLAN depends on `mcpClient.callTool('list_user_events', ...)`, but the current MCP_DOCKER tool surface does not expose a `list_user_events`-style tool. INTG-03 is not executable as written.
- **HIGH: Gmail server-side VIP override not wired.** 03-03-PLAN does not pass the documented server-side VIP override/allowlist to `list_recent_messages`, even though 03-CONTEXT.md says second-brain overrides via an allowed-senders argument. D-09 trust-boundary control is only partially implemented.
- **MEDIUM: Schema validation is top-level only.** 03-01-PLAN says loadConnectorsConfig() validates against schema, but the implementation only checks required top-level keys. That does not satisfy D-23's schema validation.
- **MEDIUM: Existing schema validator is too weak.** The repo's existing schema helper in test/config-schemas.test.js does not validate booleans, minimum/maximum, or additionalProperties. The proposed connectors.schema.json constraints would be mostly untested.
- **MEDIUM: Module-level config loading is brittle.** All three connector plans load config at module init. One bad section in connectors.json can take down every connector before Phase 4 can degrade gracefully.
- **MEDIUM: Calendar filtering is naive.** Hardcoded attendee email, start-hour-only filtering, no mention of all-day events, recurring events, or timezone normalization.
- **MEDIUM: Missing caller-error edge cases.** No specs for missing mcpClient, missing eventId/messageId, invalid hours, malformed MCP payloads, or draft params missing required fields.
- **MEDIUM: Integration tests not scheduled.** 03-CONTEXT.md calls for a live test/integration-connectors.test.js, but no execution plan schedules that work.
- **LOW: GitHub config shape ambiguity.** 03-01-PLAN stores repo names while 03-04-PLAN hardcodes the owner. Should normalize into owner + repos.

### Suggestions
- Patch 03-04: define GitHub activity in terms of tools that actually exist in MCP_DOCKER. Split config into owner + repos.
- Patch 03-03: pass project VIP allowlist to Gmail server boundary, then apply connector-side filter on top.
- Strengthen 03-01: runtime validation should validate the full schema, not just top-level presence.
- Prefer memoized lazy config loader over module-level constants.
- Add explicit edge-case specs for timezone, all-day events, malformed headers, invalid inputs.
- Add MCP tool allowlist assertions (not just export-name assertions).
- Add the live integration test plan now, not later.
- Add cross-repo contract note for gmail-mcp-pete expected tool surface.

### Risk Assessment: MEDIUM
### Gate Recommendation: PATCH-THEN-PROCEED

---

## Consensus Summary

### Agreed Strengths
- **Uniform connector contract** — both reviewers praise the D-15 shape, SOURCE enum, and no-throw guarantee as strong foundation for Phase 4 composition
- **Security posture** — zero-trust enforcement via API omission, contract tests, and OAuth scope restrictions recognized by both
- **Wave sequencing** — shared infrastructure first, connectors second is correct
- **Phase 3/4 boundary** — clean separation, no premature composite
- **Two-layer VIP filtering** — conceptually sound design, not redundant (separates trust boundary from application policy)
- **Dependency injection** — mcpClient as parameter enables testability

### Agreed Concerns

| # | Severity | Concern | Gemini | Codex | Action |
|---|----------|---------|--------|-------|--------|
| 1 | **HIGH** | GitHub tool surface mismatch — `list_user_events` may not exist in MCP_DOCKER | — | YES | **PATCH 03-04**: Verify actual MCP_DOCKER GitHub tool names and update plan |
| 2 | **HIGH** | Gmail server-side VIP override not wired — plan omits passing allowlist to `list_recent_messages` | — | YES | **PATCH 03-03**: Wire VIP allowlist argument per D-09 |
| 3 | **MEDIUM** | Schema validation is top-level only — doesn't satisfy D-23 full schema validation | — | YES | **PATCH 03-01**: Extend loadConnectorsConfig to validate against JSON schema |
| 4 | **MEDIUM** | Module-level config loading is brittle for test isolation and fault tolerance | YES | YES | **PATCH 03-01..04**: Use memoized lazy loader instead of module-level constant |
| 5 | **MEDIUM** | Calendar filtering naive — no timezone, all-day, or recurring event handling | — | YES | **PATCH 03-02**: Add specs for all-day/timezone edge cases |
| 6 | **MEDIUM** | Credential handling unspecified for Calendar and GitHub connectors | YES | — | **DISMISS**: Calendar uses Cowork native (auth handled by Claude Desktop). GitHub uses Docker MCP (auth handled by Docker gateway). No app-level credential management needed. |
| 7 | **MEDIUM** | Pagination strategy undefined | YES | — | **DEFER**: MCP tools return paginated results at their layer. Connector pagination is a Phase 4 concern if data volume exceeds single-page returns. |
| 8 | **MEDIUM** | Integration tests not scheduled in execution plans | — | YES | **ACCEPT**: Integration tests are manual pre-ship (per CONTEXT.md). Not in execution plans by design. |
| 9 | **MEDIUM** | Caller-error edge cases (missing mcpClient, invalid params) not specified | — | YES | **PATCH**: Add defensive checks — validate mcpClient exists, validate required params |
| 10 | **LOW** | GitHub config shape ambiguity (owner vs repos) | — | YES | **PATCH 03-04**: Normalize to owner + repos in config |
| 11 | **LOW** | Rate limit error identification | YES | — | **DEFER**: No-retry contract means rate limits surface as {success: false}. Phase 4 can distinguish error types if needed. |

### Divergent Views
- **Risk level**: Gemini rated LOW, Codex rated MEDIUM. The difference is Codex identified two HIGH concerns (GitHub tool surface, Gmail VIP wiring) that Gemini missed. Codex's assessment is better-grounded here — those are real execution blockers.
- **Credential handling**: Gemini flagged as MEDIUM. Codex did not — correctly, since Calendar and GitHub use managed MCP auth. Only Gmail needs app-level credentials (already specified via keytar).
- **Pagination**: Gemini flagged; Codex did not. Both positions are reasonable — MCP tools handle their own pagination. A NOTE is sufficient.

### Patches Required Before Execution

1. **03-04 (GitHub)**: Verify actual MCP_DOCKER GitHub tool names. Update `callTool` invocations to match real tool surface. Add owner + repos config normalization.
2. **03-03 (Gmail)**: Wire VIP allowlist argument to `list_recent_messages` call per D-09.
3. **03-01 (Shared infra)**: Extend loadConnectorsConfig to do real JSON schema validation (use ajv or the existing lightweight validator extended). Use memoized lazy loading pattern instead of module-level constant.
4. **03-02 (Calendar)**: Add edge-case specs for all-day events (no start hour), timezone normalization, and attendee email matching.
5. **All plans**: Add defensive input validation for mcpClient parameter and required arguments.

### Gate Recommendation: PATCH-THEN-PROCEED
Both reviewers independently reached PATCH-THEN-PROCEED. Architecture is sound. Patches are clarifications and implementation-fidelity fixes, not redesigns.
