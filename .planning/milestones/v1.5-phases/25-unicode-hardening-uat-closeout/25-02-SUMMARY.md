---
plan: 25-02
phase: 25-unicode-hardening-uat-closeout
status: complete
started: 2026-04-26T17:42:00Z
completed: 2026-04-26T17:48:00Z
tasks_completed: 2
tasks_total: 2
---

## Summary

### Task 1: UAT Corpus Rebaseline

Ran the UAT classification test against Anthropic Haiku (bypassing pipeline.local.json's LM Studio routing via `CONFIG_DIR_OVERRIDE`). All 12 deterministic cases passed at 100% accuracy — no stale expectations found, no corpus changes needed. Edge cases all handled gracefully: EDGE-02 (ISPN) correctly blocked by content-policy, EDGE-03/EDGE-04 dead-lettered as ambiguous. Added rebaseline timestamp comment to DETERMINISTIC_CASES.

Note: pipeline.local.json routes to a local LM Studio endpoint (`provider: "local"`) which returns HTTP 401. The fallback-to-Anthropic only triggers on network errors (ECONNREFUSED, etc.), not HTTP errors. UAT testing requires either Anthropic provider config or `CONFIG_DIR_OVERRIDE` to bypass local routing.

### Task 2: UAT Workflow Smoke Run

Triggered `gh workflow run uat.yml` successfully. Run ID: 24963044975. The workflow:
- Fired via `workflow_dispatch` trigger
- Executed to completion (conclusion: success) in ~61 seconds
- Produced artifact: `uat-accuracy-report-24963044975` with 90-day retention
- ANTHROPIC_API_KEY secret is configured in the repo (confirmed by successful API calls)

Phase 17 carry-forward closed: the UAT workflow infrastructure works end-to-end.

## Key Files

### Modified
- `test/uat/uat-classification.test.js` — Added rebaseline date comment (2026-04-26)

### Verified (not modified)
- `.github/workflows/uat.yml` — Confirmed working as-is

## Metrics

- UAT accuracy: 12/12 = 100% (all deterministic cases)
- Edge cases: 4/4 handled gracefully
- GitHub Actions run: success, artifact uploaded

## Self-Check: PASSED

- [x] Rebaseline comment present in DETERMINISTIC_CASES
- [x] 100% accuracy on deterministic corpus (no stale expectations)
- [x] CI skip guard works (17 tests skipped with CI=true)
- [x] `gh workflow run uat.yml` fired and completed successfully
- [x] Artifact `uat-accuracy-report-24963044975` available in GitHub Actions
