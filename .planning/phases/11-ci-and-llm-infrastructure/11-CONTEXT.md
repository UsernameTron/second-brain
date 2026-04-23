# Phase 11: CI & LLM Infrastructure - Context

**Gathered:** 2026-04-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Two infrastructure requirements that close the v1.2 automation gap:
1. **CI-01**: Add coverage enforcement and dependency audit to the GitHub Actions CI pipeline
2. **CI-02**: Wire local LLM (LM Studio at localhost:1234) as primary classifier, Anthropic Haiku as fallback

No new features. No new agents or skills. Pure infrastructure wiring.

</domain>

<decisions>
## Implementation Decisions

### CI-01: Coverage Enforcement and Dependency Audit

- **D-01:** Single CI job, sequential steps: `npm ci` → `npm test -- --coverage` → coverage threshold check → `npm audit --audit-level=high`. No parallel jobs — suite runs in ~47s, parallel adds YAML complexity and queue wait for no gain on GitHub free tier.
- **D-02:** Initial coverage threshold set at **85%** (not 90%). Current coverage is 89.96% — setting 90% on day one means the first PR fails and trains everyone to ignore gates. Ratchet to 90% after writing tests for the two modules below 80%.
- **D-03:** Coverage gap targets: `new-command.js` (72.5%) and `validate-schema.js` (74.2%) are the priority. Write tests to bring these above 80% as part of this phase, then ratchet threshold to 90%. **Sequencing constraint:** gap tests MUST land before the threshold ratchet to 90%. If they are in different waves/plans, the 90% bump goes in the later one. Never set a threshold the suite can't pass.
- **D-04:** `npm audit --audit-level=high` runs AFTER tests (not before). Audit is cheap but tests are the primary gate. Audit failure blocks the build on HIGH/CRITICAL only — matches SEC-01 agent behavior from Phase 9.
- **D-05:** Coverage report published as CI artifact per run.

### CI-02: Local LLM Routing

- **D-06:** Config-driven endpoint swap inside `createLlmClient()` in `pipeline-infra.js`. No separate routing layer. The function already exists as the single construction point — add a config field and branch internally. Callers never know. ~20-line change to an existing function.
- **D-07:** Config field in `config/pipeline.json` under `classifier`: add `llm.provider` (`"anthropic"` | `"local"`) and `llm.localEndpoint` (default `http://localhost:1234`). Model name for local LLM is configurable, not hardcoded.
- **D-08:** Local LLM uses **OpenAI-compatible API** (`/v1/chat/completions`). Every local server (Ollama, LM Studio, vLLM, llama.cpp) exposes this format. Do NOT try to make local models speak Anthropic message format.
- **D-09:** Implementation: raw `fetch` against `/v1/chat/completions` endpoint — it's one POST call. Do NOT add `openai` as a dependency. The response is parsed into the same `{ success, data, error, failureMode }` shape that `classify()` already returns.
- **D-10:** Fallback behavior: when `llm.provider` is `"local"` and the local endpoint is unreachable (connection refused, timeout), fall back to Anthropic Haiku automatically. Fallback is **explicit** — logged with `logDecision()`, not silent. Matches existing graceful degradation pattern in `createLlmClient()`.
- **D-11:** At least one test mocks the local endpoint and verifies the routing + fallback behavior.

### Claude's Discretion
- Pipeline config schema update for new `llm.*` fields (extend `config/schema/pipeline.schema.json`)
- Exact coverage threshold syntax in Jest config vs CLI flag
- CI YAML formatting and step naming conventions
- Which local LLM model name to use as default in config

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### LLM Client Architecture
- `src/pipeline-infra.js` — `createLlmClient()`, `createHaikuClient()`, `createSonnetClient()` (lines 54-163). The hook point for local LLM routing.
- `src/classifier.js` — Two-stage classifier consuming Haiku/Sonnet clients. Do not modify — routing is transparent via pipeline-infra.

### Configuration
- `config/pipeline.json` — Pipeline config with `classifier` section. Add `llm.*` fields here.
- `config/schema/pipeline.schema.json` — Schema for pipeline.json. Must be extended for new fields.

### CI Pipeline
- `.github/workflows/ci.yml` — Current CI (23 lines, bare-bones). Extend in-place.

### Phase 9 Decisions
- `.planning/phases/09-security-and-verification/09-CONTEXT.md` — SEC-01 npm audit behavior (D-04: HIGH/CRITICAL block, LOW/MEDIUM warn). CI-01 audit should match this posture.

### Coverage Gaps
- `src/new-command.js` — 72.5% coverage, priority target
- `src/utils/validate-schema.js` — 74.2% coverage, priority target

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createLlmClient()` in `pipeline-infra.js` — single LLM construction point, already accepts `options.model`. Natural hook for provider branching.
- `loadPipelineConfig()` in `pipeline-infra.js` — existing config loader for `config/pipeline.json`. Returns parsed config object.
- Graceful degradation pattern in `createLlmClient()` — returns `{ success: false, failureMode: 'api-error' }` stub on init failure. Same pattern applies to local endpoint unreachable.
- `logDecision()` from `vault-gateway.js` — existing logging function for classification decisions. Use for fallback logging.

### Established Patterns
- LLM client returns `{ success, data, error, failureMode }` shape — local provider must match this exactly
- Config schemas at `config/schema/*.schema.json` (draft-07 JSON Schema, validated by AJV via `src/config-validator.js`)
- Test convention: `src/{module}.js` → `test/{module}.test.js`

### Integration Points
- `config/pipeline.json` — new `llm` section under `classifier`
- `config/schema/pipeline.schema.json` — schema extension for `llm.*` fields
- `.github/workflows/ci.yml` — coverage + audit steps added to existing test job
- `package.json` — Jest coverage config (if threshold set via config rather than CLI)

</code_context>

<specifics>
## Specific Ideas

- Raw `fetch` for local LLM — no new dependency. OpenAI chat completions format is a single POST with `{ model, messages, max_tokens }`.
- Coverage ratchet: 85% → pass tests → write gap tests → 90%. Two-step, not one.
- Audit in CI matches SEC-01 posture: HIGH/CRITICAL block, LOW/MEDIUM warn.
- Local LLM model name should be configurable in pipeline.json, not hardcoded to any specific model.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 11-ci-and-llm-infrastructure*
*Context gathered: 2026-04-23*
