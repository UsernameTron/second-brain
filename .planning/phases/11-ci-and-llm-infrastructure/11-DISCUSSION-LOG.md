# Phase 11: CI & LLM Infrastructure - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-23
**Phase:** 11-ci-and-llm-infrastructure
**Areas discussed:** LLM routing strategy, Local LLM API compatibility, Coverage gap strategy, CI pipeline ordering

---

## LLM Routing Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Config-driven endpoint swap | Branch inside existing `createLlmClient()` based on config field. ~20-line change. Callers never know. | ✓ |
| Separate routing layer | New abstraction wrapping `createLlmClient()`. More extensible, more complex. | |

**User's choice:** Config-driven endpoint swap
**Notes:** "A separate routing layer is overengineered for two LLM providers. createLlmClient() already lives in pipeline-infra.js as the single construction point."

---

## Local LLM API Compatibility

| Option | Description | Selected |
|--------|-------------|----------|
| OpenAI-compatible API (raw fetch) | POST to `/v1/chat/completions`. No new dependency. Every local server supports this format. | ✓ |
| OpenAI SDK dependency | Add `openai` npm package. More ergonomic but adds a dependency for one POST call. | |
| Anthropic message format adapter | Make local models speak Anthropic's format. Would require translation layer. | |

**User's choice:** OpenAI-compatible API via raw fetch
**Notes:** "Don't try to make local models speak Anthropic's message format. The Anthropic SDK is already a direct dependency. It's one POST call — don't add a dependency for that."

---

## Coverage Gap Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Fix to 90% now | Set threshold at 90%, write all missing tests before CI goes live. | |
| Ratchet from 85% → 90% | Start at 85% (passes immediately), write gap tests, then bump to 90%. | ✓ |
| No threshold initially | Add coverage reporting only, enforce later. | |

**User's choice:** Ratchet from 85% → 90%
**Notes:** "Blocking the entire CI pipeline on a threshold you haven't hit yet just means the first PR fails and someone overrides the gate — which trains everyone to ignore gates. Set 85% now, ratchet after writing tests for new-command.js (72.5%) and validate-schema.js (74.2%)."

---

## CI Pipeline Ordering

| Option | Description | Selected |
|--------|-------------|----------|
| Single job, sequential steps | npm ci → test+coverage → audit. Simple YAML, no artifact passing. | ✓ |
| Parallel jobs (audit + test) | Separate jobs for audit and test. Faster in theory, more YAML complexity. | |

**User's choice:** Single job, sequential steps
**Notes:** "547 tests run in seconds. Parallel jobs add YAML complexity, artifact passing, and longer queue wait times on GitHub's free tier — all to save maybe 10 seconds. If the suite ever takes more than 2 minutes, split then. It won't."

---

## Claude's Discretion

- Pipeline config schema extension for `llm.*` fields
- Jest coverage threshold syntax (config vs CLI flag)
- CI YAML step naming conventions
- Default local LLM model name in config

## Deferred Ideas

None — discussion stayed within phase scope.
