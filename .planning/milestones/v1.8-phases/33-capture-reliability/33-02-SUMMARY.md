# Plan 33-02 Summary — classifier-health tracker + Haiku cap

**Status:** Complete
**Requirement:** CAP-CLASSIFIER-01 (state layer; wiring is 33-03)

## What shipped
- **`config/pipeline.json`** — added `classifier.haikuNightlyCap: 50` (sibling of `llm`).
- **`config/schema/pipeline.schema.json`** — added `haikuNightlyCap` as an optional integer (min 1, max 1000) under `classifier.properties`; NOT in `required`. Applied by the operator via `!` (the path is protected-file-guarded from automated edits); orchestrator verified the diff and `loadPipelineConfig()` validity before committing.
- **`src/utils/classifier-health.js`** — voyage-health clone persisting to `~/.cache/second-brain/classifier-health.json`. Exports `recordFailure(code)` / `recordSuccess()` / `isDegraded()` / `getDegradedReason()` / `recordHaikuCall(dateKey?)` / `isHaikuCapReached(cap, dateKey?)` / `DEGRADED_FAILURE_THRESHOLD`. Reuses `getSemanticCacheDir` from voyage-health (CACHE_DIR_OVERRIDE-honoring). Atomic tmp+rename writes, fail-open on every read.
- **`test/utils/classifier-health.test.js`** — 8 tests, per-test `CACHE_DIR_OVERRIDE` mkdtemp isolation. Pure fs, no network → intentionally not CI/UAT-guarded.

## Key design decisions
- Failure codes: `http` (non-2xx/shape), `parse` (JSON), `timeout` (PR #83's 60s abort). 3 consecutive → 15-min degraded window; `recordSuccess` resets.
- Haiku counter keyed by **local** YYYY-MM-DD (`_localDateKey`, injectable for the rollover test); a stored count from a prior day reads as 0 so last night's fallbacks never cap tonight.
- One state file holds both concerns (`{consecutive_failures, last_failure, last_failure_code, degraded_until, haiku_date, haiku_calls}`); failure and Haiku-count tracks are independent (asserted).

## Verification
- `npx jest test/utils/classifier-health.test.js` → 8/8 pass.
- `npx eslint src/utils/classifier-health.js` → 0 errors.
- `node -e "require('./src/pipeline-infra').loadPipelineConfig()"` → validates; cap resolves to 50.

## Deviations
- **Blocking dependency surfaced mid-execution:** the schema edit is protected-file-guarded (hard block, no bypass). Rather than engineer around the guard, the orchestrator asked the operator, who applied the one-property addition via an in-session `!` node one-liner. Everything else proceeded; the pipeline.json change sat uncommitted (config was transiently schema-invalid) until the schema half landed — no commit was attempted in that window.
- Executed inline by the orchestrator (not a spawned gsd-executor) per session preference.
