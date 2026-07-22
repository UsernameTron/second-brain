# Plan 33-03 Summary — classifier-health wired into createLlmClient

**Status:** Complete
**Requirement:** CAP-CLASSIFIER-01 (behavior half)

## What shipped
- **`src/pipeline-infra.js`** — new `classifyLocalWithHealth` wrapper on the `useLocal` classify seam:
  - counts every local failure (http/shape/parse/timeout) via `classifier-health.recordFailure`
  - falls back to Haiku on ANY of them (was: only network/timeout)
  - fast-paths straight to Haiku while `isDegraded()` (skips the local attempt → no 60s timeout)
  - enforces the per-night Haiku cap: `isHaikuCapReached(cap)` → returns `{success:false, skipped:true, failureMode:'haiku-cap'}` + logs SKIPPED, never throws
  - `recordSuccess()` on a clean local call. Cap read from `pipelineConfig_.classifier.haikuNightlyCap ?? 50` (verifier-caught: NOT `llmConfig.*`).
  - `classifyLocal`'s network-catch now returns `{failureMode:'timeout'}` instead of self-falling-back, so the wrapper owns the single fallback chokepoint. The `!useLocal` path (dream pin / default) is untouched.
- **`test/pipeline-infra.test.js`** — both local blocks (`classifyLocal — LLM fallback hardening` and `local LLM routing`) given `CACHE_DIR_OVERRIDE` isolation; contract assertions updated (see below); new cases: http failure records + falls back, 3-consecutive → degraded skips local, success resets, Haiku-cap skip, provider:anthropic bypasses the wrapper.

## Contract inversion (operator-blessed at the phase boundary)
Per the roadmap goal ("extended to HTTP/parse errors"), HTTP/shape/**parse** local failures now fall back to Haiku instead of failing hard. This reverses a prior documented **"HARD CONSTRAINT"** (`test.each` that asserted parse errors must fail loudly with no fallback). Resolution: the failure stays **loud** — logged (`PARSE_ERROR`/`SHAPE_ERROR`/`ERROR`) and recorded in classifier-health (drives the 3-strike degrade) — but the sweep recovers via Haiku. The downside the old constraint guarded (masking a broken prompt/parser, unbounded Haiku spend) is bounded by degrade-after-3 + the 50/night cap. Operator explicitly blessed this call ("make the decision supporting the expected outcomes"). Durable rationale left in the source comment + rewritten tests so a future session won't misread it as a regression.

## Verification
- Full suite green: 1465 passed / 29 skipped, 0 failures (`npm test`).
- `npm run lint` clean (0 errors; src/ files no-console-clean).
- Tests exercise: fallback on all four failure classes, degrade skip, cap skip (no throw), success reset, and the untouched anthropic path.

## Deviations
- Executed inline by the orchestrator (session preference). The session auto-commit hook (`git add -u`) swept the tracked edits into `chore(session)` commits during long test runs; all work is committed and marker-verified in HEAD, and the branch squash-merges so intermediate messages collapse.
- The slow single-file `npx jest test/pipeline-infra.test.js` path (5-7 min in isolation all session) was bypassed in favor of the fast parallel full suite for validation.
