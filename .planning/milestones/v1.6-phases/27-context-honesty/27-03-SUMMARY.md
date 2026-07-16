---
phase: 27-context-honesty
plan: 03
subsystem: infra
tags: [semantic-search, voyage, fail-closed, content-policy, jest]

# Dependency graph
requires:
  - phase: 27-context-honesty (27-01, 27-02)
    provides: reach layer + authority hierarchy context (no code dependency; same phase)
provides:
  - Fail-closed guard in semanticSearch on empty/unloadable excluded terms
  - Regression coverage proving no Voyage/checkContent call on empty terms
affects: [semantic-index, classifier, recall-cli, memory-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fail-closed consumer-side guard mirroring vault-gateway: an unloadable safety
       config denies the operation rather than passing through, without changing the
       loader's fail-open contract (loadExcludedTerms still returns [] on error per
       config-loaders-malformed.test.js)"

key-files:
  created: []
  modified:
    - src/semantic-index.js
    - test/semantic-index.test.js
    - test/semantic-index-errors.test.js
    - test/integration/semantic-search.test.js

key-decisions:
  - "Guard placed in semanticSearch (the consumer), not loadExcludedTerms (the loader) — preserves the existing fail-open loader contract asserted by config-loaders-malformed.test.js:154, matches the plan's explicit instruction not to touch pipeline-infra.js"
  - "hybridSearch required no code change: its existing `if (semRes.blocked) return {...}` propagation (line ~505) already surfaces the new failClosed block correctly"
  - "test/classifier.test.js required no mock changes — its loadExcludedTerms mocks feed the classifier's own ingress gate (checkContent mocked directly), never semanticSearch/hybridSearch; confirmed by running the full suite with no classifier failures"

patterns-established:
  - "Pattern: safety-critical config gates fail closed at the read site, not the loader — loader keeps returning a safe empty default for other unaffected callers"

requirements-completed: [REQ-CTX-03]

# Metrics
duration: ~25min
completed: 2026-07-15
---

# Phase 27 Plan 03: Semantic Search Fail-Closed Guard Summary

**semanticSearch now fails closed with `{blocked:true, failClosed:true}` when `loadExcludedTerms()` returns empty/unloadable, closing the silent-ungated-Voyage-query hole that reopened the F-01 exclusion bypass.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-15
- **Tasks:** 2 (both completed)
- **Files modified:** 4

## Accomplishments
- Added a fail-closed guard in `semanticSearch` (src/semantic-index.js) that returns a blocked result with no Voyage or `checkContent` call when `excludedTerms` is empty or not an array
- Confirmed `hybridSearch`'s existing blocked-propagation (line ~505) already covers the new fail-closed path with zero code changes needed
- Updated 3 test files' `loadExcludedTerms` mocks from `() => []` to real terms so existing semanticSearch/hybridSearch coverage isn't blocked by the new guard
- Added a regression test proving empty excluded terms produce `{blocked:true, failClosed:true}` with no `checkContent`/Voyage call
- Full suite green under CI: 1202 passed, 38 skipped, 0 failed; coverage thresholds hold (branches 81.07/80, functions 96.03/90, lines 93.18/90, statements 92.57/90)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add fail-closed guard to semanticSearch** - `fecec1e` (feat)
2. **Task 2: Update mocks and add regression coverage** - `0d353ca` (test)

_Note: single-commit-per-task; no TDD red/green split requested by plan._

## Files Created/Modified
- `src/semantic-index.js` - fail-closed guard added immediately after `loadExcludedTerms()`, before `checkContent`
- `test/semantic-index.test.js` - 2 mocks updated (lines 48, 742) to return real terms; new regression test added in the `semanticSearch` describe block
- `test/semantic-index-errors.test.js` - 1 mock updated (line 52) to return real terms so Voyage-failure-path tests still reach the Voyage client
- `test/integration/semantic-search.test.js` - shared `beforeEach` now writes a real `excluded-terms.json` into the temp config dir so Scenarios 1, 4, 6 (which use the REAL pipeline-infra module and don't spy on `loadExcludedTerms`) aren't blocked by the new guard; Scenario 5 already injected terms via `jest.spyOn` and needed no change

## Decisions Made
- Guard lives at the consumer (semanticSearch), not the loader (loadExcludedTerms in pipeline-infra.js) — per plan instruction and to preserve the loader's existing fail-open contract that another test explicitly asserts
- test/classifier.test.js's 5 `loadExcludedTerms` mocks left untouched — verified via full-suite run that none of its tests exercise semanticSearch/hybridSearch (classifier's own ingress gate calls `checkContent` directly, which is separately mocked)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree branch was stale, missing phase 27 plan commits**
- **Found during:** Start of execution (attempting to read 27-03-PLAN.md)
- **Issue:** The execution worktree's branch (`worktree-agent-a2fc58de5456ccb52`) was pinned at commit `399e188`, strictly behind `master`'s `69a2ff2` with zero divergent commits of its own. `.planning/phases/27-context-honesty/` did not exist at all in the worktree — the 27-01/27-02/27-03 plan and summary files, `27-CONTEXT.md`, ADR-020, and the staleness hook all existed only on `master` in the main repo checkout.
- **Fix:** Verified the worktree branch was a strict ancestor of `master` (`git merge-base HEAD master` == worktree HEAD) with a clean working tree, then ran `git merge --ff-only master` to fast-forward. Confirmed via diff that the commits being pulled in did not touch `src/semantic-index.js` (the file this plan modifies), so no risk of pulling in conflicting or out-of-scope code changes.
- **Files modified:** none directly (git history operation only)
- **Verification:** `.planning/phases/27-context-honesty/27-03-PLAN.md` readable after fast-forward; `git diff 399e188 69a2ff2 -- src/semantic-index.js` was empty before merging, confirming the merge was safe and in-scope
- **Committed in:** N/A (fast-forward merge, no new commit created; pre-existing commits `5f94ad5`..`69a2ff2` now part of this branch's history)

**2. [Rule 1 - Bug] Integration test file needed a real excluded-terms.json, not just mock updates**
- **Found during:** Task 2, full-suite run
- **Issue:** `test/integration/semantic-search.test.js` uses the REAL `pipeline-infra` module (only `voyageai` is mocked). Scenarios 1, 4, and 6 didn't write `excluded-terms.json` into the temp config dir, so the real `loadExcludedTerms()` returned `[]` and the new fail-closed guard correctly blocked them — surfacing as `mode: 'keyword'` instead of `'semantic'`, `degraded: undefined` instead of `false`, etc.
- **Fix:** Added `excluded-terms.json` with real terms to the shared `beforeEach`'s temp config dir. Scenario 5 (which explicitly tests the block path via `jest.spyOn(loadExcludedTerms)`) needed no change since its spy already overrides the file-based value.
- **Files modified:** test/integration/semantic-search.test.js
- **Verification:** `CI=true npx jest test/integration/semantic-search.test.js` — 9/9 passed
- **Committed in:** `0d353ca` (Task 2 commit)

---

**Total deviations:** 2 (1 blocking worktree-sync fix, 1 bug fix for integration test fixture completeness)
**Impact on plan:** Both were necessary to execute and verify the plan at all; no scope creep — no unrelated files touched, no `src/pipeline-infra.js` change (explicitly forbidden by the plan and left untouched).

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- REQ-CTX-03 (this absorbed-debt slice) is closed: `/recall --semantic` and `--hybrid` now fail closed on a missing/corrupt `config/excluded-terms.json` instead of silently shipping ungated queries to Voyage
- `src/pipeline-infra.js` `loadExcludedTerms()` intentionally unchanged — still returns `[]` on error, as required by `config-loaders-malformed.test.js:154`
- No blockers for subsequent phase 27 or phase 28 work

---
*Phase: 27-context-honesty*
*Completed: 2026-07-15*

## Self-Check: PASSED

- FOUND: src/semantic-index.js
- FOUND: test/semantic-index.test.js
- FOUND: test/semantic-index-errors.test.js
- FOUND: test/integration/semantic-search.test.js
- FOUND: .planning/phases/27-context-honesty/27-03-SUMMARY.md
- FOUND: commit fecec1e
- FOUND: commit 0d353ca
