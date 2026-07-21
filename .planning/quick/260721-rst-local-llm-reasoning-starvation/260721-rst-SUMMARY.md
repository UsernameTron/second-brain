# Quick Task 260721-rst — Fix reasoning-model starvation in local LLM path

**Date:** 2026-07-21
**Branch:** `fix/local-llm-reasoning-starvation` (off `master`)
**Code commit:** `6d8c472`

## Problem

`classifyLocal()` calls an OpenAI-compatible local endpoint (LM Studio). The
local model `qwen/qwen3.6-27b` reasons by default; at small `max_tokens` it
spends the entire budget in the hidden `<think>` phase and returns **empty
`content` with `finish_reason=length`** — every local classify failed with a
generic shape error.

## Changes

| File | Change |
|------|--------|
| `src/pipeline-infra.js` | `classifyLocal()` request body: added `reasoning_effort: 'none'` + `chat_template_kwargs: { enable_thinking: false }`. Empty `content` + populated `reasoning_content` now logs a distinct `SHAPE_ERROR` reason `reasoning-starved`. |
| `config/pipeline.json` | `classifier.llm.localModel` `qwen2.5-coder-7b` → `qwen/qwen3.6-27b`. |
| `config/pipeline.local.json` *(gitignored overlay — machine-local, not committed)* | added `classifier.llm.localTimeoutMs: 60000` (27B first-token latency exceeds the 10s default). |
| `test/pipeline-infra.test.js` | updated base-model assertion; added a `reasoning-starved` unit test. |

## Key finding — task spec corrected against live behavior

The task specified `chat_template_kwargs: { enable_thinking: false }` as the
disable flag. **Live testing refuted it.** Probe against LM Studio + qwen3.6-27b:

| Mechanism | content | reasoning_content | finish |
|-----------|--------:|------------------:|--------|
| `chat_template_kwargs.enable_thinking:false` | 0 | 1210 | length |
| `/no_think` in system prompt | 0 | 1183 | length |
| baseline (nothing) | 0 | 1143 | length |
| **`reasoning_effort: 'none'`** | **144** | **0** | **stop** |

`reasoning_effort: 'none'` (OpenAI-style, top-level) is what LM Studio honors.
The requested kwarg is kept as the vLLM/HF equivalent for other backends; it is
inert on this stack. The `reasoning-starved` guard is the backstop if neither
flag lands.

## Verification

- `npm test`: **1355 passed, 29 skipped** (green).
- Live call, merge-style prompt, `max_tokens: 300`: **content = 165 chars of
  valid JSON, `reasoning_content` = 0, `finish_reason = stop`** → PASS.

## Out of scope (pre-existing)

Test logs emit `pipeline.local.json exists but "pipeline" is not wired to
loadConfigWithOverlay — overlay will be ignored`. That warning is from the
generic `loadConfigWithOverlay`; pipeline-infra's own `loadPipelineConfig`
**does** apply the overlay (confirmed: `provider=local` + `localTimeoutMs`
active at runtime), so this fix works. Wiring that generic loader is a separate
concern predating this task.
