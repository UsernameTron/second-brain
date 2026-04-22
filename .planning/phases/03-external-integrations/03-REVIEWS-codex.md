---
phase: 03
reviewers: [codex]
reviewed_at: 2026-04-22T00:00:00Z
model: gpt-5.4
plans_reviewed: [03-01-PLAN.md, 03-02-PLAN.md, 03-03-PLAN.md, 03-04-PLAN.md]
---

# Cross-AI Plan Review — Phase 03 (Codex)

## Top Findings

- `HIGH`: The shared foundation plan says connector config is schema-validated at boot, but the implementation steps only require top-level key checks in `loadConnectorsConfig()`. That does not satisfy D-23's fail-fast schema guarantee and will let invalid values slip through.
- `HIGH`: The Gmail plan claims a two-layer VIP model, but the planned MCP call omits the server-side override parameter described in context. It also says `vipOnly: false` returns "all messages," which conflicts with the server-side hard ceiling.
- `HIGH`: The GitHub plan depends on an unverified `list_user_events` tool and has inconsistent semantics for `config.github.repos`, so it is the likeliest implementation blocker.

---

## Plan 03-01: Shared Connector Infrastructure

**Summary**
Strong foundation plan overall. It is appropriately thin, matches the repo's existing `config/` and CommonJS patterns, and gives the later connector plans a clean contract. The main gap is that it promises schema validation and fail-fast config behavior, but the actual steps only implement presence checks, not real schema enforcement.

**Strengths**
- Clear single responsibility: shared types, config, schema, and test helpers only.
- Good dependency ordering: Wave 2 genuinely depends on this.
- Uniform return contract is explicit and testable.
- Reuses existing project conventions instead of inventing a new config system.

**Concerns**
- `HIGH`: Runtime schema validation is not actually specified. The loader only checks required top-level sections, which is weaker than D-23's "validated at boot against schema."
- `MEDIUM`: The referenced project pattern in `loadPipelineConfig()` is only a required-key check, so "follow the exact pattern" bakes in the same limitation.
- `MEDIUM`: The existing test validator is intentionally minimal and will not enforce constraints like `minimum`, `maximum`, or `additionalProperties`, even though the new schema encodes them.
- `LOW`: The config shape leaves later plans to hardcode identity-specific values like Pete's email and GitHub username instead of centralizing them here.

**Suggestions**
- Make `loadConnectorsConfig()` perform real schema validation at runtime, not just required-key checks.
- Add tests for invalid scalar values and extra properties, not only missing sections.
- Add identity fields to config now if later connectors need them, such as `calendar.selfEmail` and `github.username`.
- Keep the helpers strict on required fields, but avoid coupling them to implementation details that make harmless evolution painful.

**Risk Assessment**
`MEDIUM`: good structure, but this plan underpins all three connectors, so weak config validation becomes a systemic risk.

---

## Plan 03-02: Calendar Connector

**Summary**
This is a solid thin-adapter plan and it aligns with the "no composite fan-out in Phase 3" boundary. The main issues are test brittleness around config loading and under-specified event filtering semantics for real calendar data.

**Strengths**
- Good use of dependency injection via `mcpClient`.
- Public API is minimal and aligned with the read-only contract.
- No-throw behavior is explicit and consistent with D-18.
- Unit tests focus on the actual responsibilities of this connector.

**Concerns**
- `MEDIUM`: The plan imports the connector before setting `CONFIG_DIR_OVERRIDE`, while also loading config at module init. In Jest, that will make temp-config tests unreliable or wrong.
- `MEDIUM`: Working-hours filtering is too naive. Filtering only on the start hour will mishandle all-day events, events spanning the boundary, and timezone-sensitive events.
- `MEDIUM`: The declined-event filter hardcodes Pete's email instead of sourcing identity from config or the event data model.
- `MEDIUM`: The read-only test only checks export names. D-02 is stricter: the module should not reference write-capable tools at all.
- `LOW`: The `mcpClient` tool-name contract is still fuzzy; "or equivalent" leaves an integration seam undefined.

**Suggestions**
- Load config lazily inside each function, or set env overrides before requiring the module and use `jest.resetModules()`.
- Define exact filtering semantics for all-day, cross-midnight, and timezone-shifted events.
- Move the "self email" needed for declined filtering into config.
- Add a negative assertion on `mcpClient.callTool.mock.calls` to prove no write tool names are ever invoked.

**Risk Assessment**
`MEDIUM`: implementable, but some real-world calendar cases and test setup details are still under-specified.

---

## Plan 03-03: Gmail Connector

**Summary**
The scope is right and the safety posture is mostly right, but the plan currently does not implement the trust boundary it describes. The biggest problem is that the written steps do not actually exercise the server-side VIP override, so the two-layer filtering story is incomplete.

**Strengths**
- Connector surface is tightly constrained to the three approved tools.
- Good no-send focus in both API and tests.
- Dependency injection and no-throw results fit the rest of the phase.
- The subset contract is the right shape for validating connector-side narrowing.

**Concerns**
- `HIGH`: D-09 says second-brain overrides the server's VIP ceiling via an argument on `list_recent_messages`, but the planned MCP call does not pass that argument. The plan therefore does not implement the two-layer filter it claims.
- `HIGH`: `vipOnly: false` is defined as returning "all messages," which conflicts with the stated server-side hard ceiling. That is either a misleading contract or a trust-boundary leak.
- `MEDIUM`: `message.from` comparison is underspecified. Real headers need normalization/parsing before reliable VIP matching.
- `MEDIUM`: Same config-load/test-order issue as calendar.
- `MEDIUM`: The negative tool test only bans `send_message`; it should prove the connector uses only the three allowed Gmail tools.

**Suggestions**
- Pass the connector's VIP list to `list_recent_messages` so the server-side ceiling and connector-side subset both exist.
- Redefine `vipOnly=false` to mean "full server-allowed set," or remove the flag if it adds ambiguity.
- Add an `extractEmailAddress()` helper with tests for `"Name <email>"` and case variants.
- Tighten the tool-call contract test to an allowlist: only `list_recent_messages`, `get_message_body`, and `create_draft`.

**Risk Assessment**
`HIGH`: the current plan does not fully satisfy its own security model, so it can pass unit tests while still violating the intended boundary.

---

## Plan 03-04: GitHub Connector

**Summary**
This is the riskiest of the four plans. The adapter itself is simple, but the plan assumes an upstream activity-feed interface that is not otherwise documented in the repo, and it contradicts the shared config plan about what `github.repos` contains.

**Strengths**
- Minimal public API.
- Filtering dimensions are sensible: repo, type, and time window.
- Uses the same contract and DI pattern as the other connectors.
- Good separation from Phase 4 composition concerns.

**Concerns**
- `HIGH`: The plan assumes a `list_user_events` tool without proving that interface exists. If the upstream Docker MCP surface differs, this plan stalls immediately.
- `HIGH`: `config.github.repos` is inconsistent across plans. The shared plan creates bare repo names, but this plan's read-first note describes `["UsernameTron"]`, and the implementation then expects `owner/name` strings to split.
- `MEDIUM`: A malformed event shape can fail the whole connector instead of being skipped.
- `MEDIUM`: Same config-load/test-order problem as the other Wave 2 plans.
- `MEDIUM`: The context expects a live integration test path for connectors, but this plan does not include it, which matters more here because the upstream contract is uncertain.

**Suggestions**
- Verify the actual Docker MCP GitHub activity capability before implementation and write that interface into the plan.
- Normalize `github.repos` now. Full `owner/repo` strings are the least ambiguous.
- Treat malformed events as skippable records unless the upstream response is structurally unusable.
- Add a live probe or integration test as part of this plan, not as a vague later step.

**Risk Assessment**
`HIGH`: there is too much unresolved upstream-contract risk for this to be considered execution-ready.

---

## Overall Assessment

Overall phase-plan risk is `MEDIUM-HIGH`. The architecture is disciplined and the phase boundary is clear, but the plans are not yet fully execution-safe because one shared runtime guarantee is missing, the Gmail trust model is only partially implemented, and the GitHub connector depends on an unverified upstream interface. The biggest improvement would be one additional phase-level verification plan for live connector/integration checks, since the context already expects integration-connectors.test.js.
