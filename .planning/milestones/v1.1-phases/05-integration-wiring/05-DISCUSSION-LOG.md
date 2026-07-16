# Phase 5: Integration Wiring - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-22
**Phase:** 05-integration-wiring
**Areas discussed:** Gmail OAuth Bootstrap, Excluded Terms List, RemoteTrigger Activation

---

## Gmail OAuth Bootstrap

| Option | Description | Selected |
|--------|-------------|----------|
| CLI setup script (`scripts/auth.js`) | One-time browser OAuth flow, stores tokens via keytar | ✓ |
| Manual token copy-paste | User generates token externally, pastes into config | |
| Environment variable tokens | Store tokens in env vars instead of Keychain | |

**User's choice:** CLI setup script with auto-refresh and no fail-fast
**Notes:** Standard Google OAuth2 desktop flow. Auto-refresh via googleapis native handling. Failed refresh returns error per no-throw contract — briefing degrades gracefully. All three tool stubs wired to real googleapis calls.

---

## Excluded Terms List

| Option | Description | Selected |
|--------|-------------|----------|
| Substring, case-insensitive | Match term anywhere in text, ignore case | ✓ |
| Exact match | Only match whole-word occurrences | |
| Regex patterns | Full regex support per term | |

**User's choice:** Substring + case-insensitive. No regex. 15-20 terms covering former employers, project codenames, client names, internal tools.
**Notes:** Exact strings to be provided during execution. Planner should create task that accepts user input for the term list.

---

## RemoteTrigger Activation

| Option | Description | Selected |
|--------|-------------|----------|
| Enable and observe | Enable trigger, watch one scheduled fire, confirm | ✓ |
| Staged rollout | Multiple test runs before enabling permanently | |
| Shadow mode | Run alongside manual /today, compare outputs | |

**User's choice:** Enable, observe one fire, leave on. Manual DST cron updates acceptable (2x/year). Gmail degrades in cloud — accepted limitation.
**Notes:** RemoteTrigger cannot reach local gmail-mcp-pete server. Gmail section will show degraded when running from Anthropic cloud. Calendar, GitHub, vault, and slippage sections still work. Delete test trigger before creating real one.

---

## Claude's Discretion

- Keychain key naming convention
- Gmail query syntax optimization for allowedSenders
- Error message format alignment with Phase 3 D-10
- Whether to add `hours` parameter to `list_recent_messages` tool schema

## Deferred Ideas

None
