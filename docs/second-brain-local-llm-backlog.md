# Backlog: Wire Local LLM (LM Studio) into Second-Brain Pipeline

## Context

LM Studio is installed and configured on this machine (M4 Pro, 48 GB unified memory, 37.44 GB VRAM). The local server runs at `http://localhost:1234` with OpenAI-compatible endpoints (`/v1/chat/completions`, `/v1/models`). Two models are available:

- **Gemma 4 E4B** (google/gemma-4-e4b) — 4B effective params (MoE), Q4_K_M, 6.33 GB. Use case: Haiku replacement for classification tasks.
- **Qwen3.5 27B** (qwen/qwen3.5-27b) — 27B params, Q4_K_M, 17.47 GB. Use case: advanced reasoning tasks requiring Sonnet-class output.

Server settings: port 1234, no auth, JIT model loading enabled (auto-loads on first request, auto-unloads after 60 min idle), headless service enabled (runs without GUI).

## Problem

The second-brain pipeline has 5 LLM call sites, all hardcoded to Anthropic's API via `new Anthropic()` SDK. There is no configuration for swapping endpoints. Every capture, classification, and memory extraction burns Anthropic API credits. On an M4 Pro with 48 GB, these routine classification tasks should run locally at zero cost.

## Current LLM Call Sites

| Call Site | File | Line(s) | Current Model | Purpose |
|-----------|------|---------|---------------|---------|
| Content filter | `src/content-policy.js` | ~116 | `claude-haiku-4-5` | BLOCK/ALLOW decision on vault content |
| Voice gate | `src/classifier.js` | ~173 | Haiku (via wrapper) | LEFT/RIGHT classification |
| Directory pick | `src/classifier.js` | ~282 | Haiku (via wrapper) | Subdirectory routing |
| Directory escalation | `src/classifier.js` | ~309 | Sonnet (via wrapper) | Escalation when Haiku confidence < 0.8 |
| Memory extraction | `src/memory-extractor.js` | ~293, 309, 357 | Haiku (via wrapper) | Extract memory candidates from transcripts |

## Current Abstraction

`src/pipeline-infra.js` has a `createLlmClient()` factory (lines 54-141) that wraps `anthropic.messages.create()` with structured error handling (`{ success, data, error, failureMode }`), JSON parsing, and logging. Two public constructors: `createHaikuClient()` (line 150) and `createSonnetClient()` (line 162). Model names are hardcoded.

`src/content-policy.js` line 24 instantiates its own `new Anthropic()` client directly — it does NOT use the pipeline-infra wrapper.

## Requirements

1. **Add `LLM_PROVIDER` configuration** to control whether calls route to Anthropic API or local LM Studio. Options: `anthropic` (default, current behavior) or `local`. Config should live in environment variables or `config/pipeline.json`.

2. **Add `LLM_LOCAL_ENDPOINT` config** — defaults to `http://localhost:1234`. Used only when `LLM_PROVIDER=local`.

3. **Add `LLM_LOCAL_MODEL` config** — the model identifier to send in API requests. Defaults to `gemma-4-e4b` (or whatever LM Studio exposes via `/v1/models`). This replaces the Haiku model name when running locally.

4. **Modify `pipeline-infra.js`** — update `createLlmClient()` to support both providers. When `LLM_PROVIDER=local`, use an OpenAI-compatible HTTP client (raw `httpx`/`fetch` or the `openai` npm package) pointing at the local endpoint. The wrapper's `classify()` method must maintain the same `{ success, data, error, failureMode }` return contract.

5. **Modify `content-policy.js`** — replace the direct `new Anthropic()` instantiation with the pipeline-infra wrapper, or add the same provider-switching logic. The `classifyWithHaiku()` function must work identically with either backend.

6. **Routing rules:**
   - All 4 Haiku call sites → local model when `LLM_PROVIDER=local`
   - Sonnet escalation in classifier.js → stays on Anthropic API always (local models aren't reliable enough for escalation-grade reasoning)
   - If local server is unreachable, fail gracefully with `{ success: false, failureMode: 'local-unavailable' }` — do NOT fall back to Anthropic silently (cost surprise)

7. **No new npm dependencies if possible.** The project uses raw `httpx` patterns (per CTG platform constraint). Use `fetch` or `node:http` to call the OpenAI-compatible endpoint. If adding `openai` npm package is cleaner, flag it as a deviation.

8. **Prompt compatibility:** LM Studio's OpenAI-compatible endpoint uses `messages` format (system + user messages). The existing Anthropic prompts in classifier.js and content-policy.js use `system` + `messages` which maps cleanly. Verify the response parsing handles the OpenAI response shape (`choices[0].message.content`) vs Anthropic shape (`content[0].text`).

## Architecture Constraint

The `createLlmClient()` wrapper is the right place for this abstraction. Do NOT create a separate "local LLM" module — extend the existing factory with provider awareness. One interface, two backends.

## Acceptance Criteria

- `LLM_PROVIDER=local` routes Haiku calls to `http://localhost:1234/v1/chat/completions`
- `LLM_PROVIDER=anthropic` (or unset) preserves current behavior exactly
- Sonnet escalation always uses Anthropic regardless of provider setting
- Local server down → `{ success: false, failureMode: 'local-unavailable' }`, no silent Anthropic fallback
- All existing tests pass with `LLM_PROVIDER=anthropic`
- New tests cover local provider path with mocked HTTP responses
- `content-policy.js` uses the same provider-switching logic as classifier.js

## Not In Scope

- Prompt tuning for local models (if classification accuracy drops, that's a separate task)
- Automatic model loading via LM Studio API (JIT handles this)
- Sonnet-class local model routing (keep Sonnet on Anthropic)
- LM Studio installation or configuration (already done)
