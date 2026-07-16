---
phase: 11-ci-and-llm-infrastructure
plan: 01
status: complete
started: 2026-04-23T22:00:00.000Z
completed: 2026-04-23T22:30:00.000Z
requirement_ids: [CI-02]
---

# Plan 11-01 Summary: Local LLM Provider Routing

## One-liner

Wired local LLM (LM Studio) as configurable classifier endpoint with Anthropic Haiku fallback and explicit logging.

## What was built

- Added `classifier.llm` config fields to `config/pipeline.json` (provider, localEndpoint, localModel)
- Extended `config/schema/pipeline.schema.json` with validation for new fields (optional, backward compatible)
- Implemented `classifyLocal()` in `createLlmClient()` — uses `fetch()` to POST to OpenAI-compatible `/v1/chat/completions` endpoint
- Falls back to Anthropic on connection failure with `logDecision('LLM_CLASSIFY', model, 'FALLBACK', ...)` logging
- Parse errors from local endpoint return `parse-error` without fallback (per plan spec)
- No `openai` dependency — raw `fetch()` only

## Key files

### Created
(none — all modifications)

### Modified
- `config/pipeline.json` — added `classifier.llm` section
- `config/schema/pipeline.schema.json` — added `llm` property under classifier
- `src/pipeline-infra.js` — added `classifyLocal()`, refactored `classify` to `classifyAnthropic()`, dispatch based on config
- `test/pipeline-infra.test.js` — 6 new tests for local LLM routing

## Test results

- 60 tests in pipeline-infra.test.js — all passing
- Full suite: no regressions

## Self-Check: PASSED

All acceptance criteria met:
- [x] Local endpoint configurable in pipeline.json
- [x] createLlmClient() routes to local when provider is "local"
- [x] Fallback to Anthropic on connection failure with logDecision()
- [x] Schema validates new fields
- [x] No openai dependency
- [x] All tests pass

## Decisions

- Refactored single `classify` function into `classifyLocal` and `classifyAnthropic` for clarity
- `useLocal` flag determined at client creation time (not per-call) for consistency
- Parse errors from local endpoint do NOT trigger fallback (intentional — parse errors indicate the model responded but gave bad output)
