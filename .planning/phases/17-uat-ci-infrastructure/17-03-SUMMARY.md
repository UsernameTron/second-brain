---
phase: 17-uat-ci-infrastructure
plan: "03"
subsystem: ci-infrastructure
tags: [branch-protection, github-api, gh-cli, security, BRANCH-PROT-01]
dependency_graph:
  requires:
    - "17-01 (uat.yml on origin — status check name confirmed)"
    - "17-02 (npm script wired — independent but same phase)"
  provides: [branch-protection-master, force-push-blocked, required-status-checks]
  affects: [all future PRs to master, ci-pipeline enforcement]
tech_stack:
  added: []
  patterns:
    - "gh api PUT /branches/{branch}/protection for programmatic rule creation"
    - "enforce_admins: false as deliberate admin-bypass tradeoff for solo-developer emergency access"
    - "branch-protection-snapshot.json as auditable evidence artifact"
key_files:
  created:
    - .planning/phases/17-uat-ci-infrastructure/branch-protection-snapshot.json
  modified: []
decisions:
  - "enforce_admins: false — repo owner retains emergency push bypass with explicit GitHub admin-bypass warning. Non-admin contributors and all force-push attempts are blocked. Deliberate tradeoff: solo developer emergency access preserved, documented in snapshot."
  - "required_pull_request_reviews object included in gh api payload (not null) to satisfy GitHub API validation — does not require reviewer count > 0 for solo repo"
  - "UAT Accuracy Tests intentionally NOT a required check — workflow runs on schedule/dispatch, not on PRs; making it required would permanently block all PR merges"
metrics:
  duration_minutes: 35
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 0
  completed_date: "2026-04-24"
---

# Phase 17 Plan 03: Branch Protection on Master — Summary

**One-liner:** Branch protection on master enforced via `gh api` with required CI/CodeQL status checks, force-push blocked, admin-bypass preserved for emergency access, and human-verified in GitHub UI post-merge.

## What Was Built

Applied a branch protection rule on `master` via `gh api PUT /repos/.../branches/master/protection`, requiring that `test (20)`, `test (22)`, and `Analyze` status checks pass before any PR can merge. Force-push and branch deletion are both blocked. The active rule is captured in `branch-protection-snapshot.json` as a verifiable audit artifact.

## Commits Referenced

| Commit | Description | Context |
|--------|-------------|---------|
| `19e8037` | chore: v1.4 milestone start + Phase 17 UAT CI Infrastructure (#32) | Squashed PR #32 — contains Task 1 `gh api` call, original snapshot, and fix commit that added `required_pull_request_reviews` to the payload |
| `f1e224f` | test: branch protection smoke test | Empty commit on master used as direct-push smoke test; preserved in history as evidence that admin bypass produces explicit GitHub warning |

**Web UI commits that were reverted via PR #32:**
- `b33ca14` — "Add ANTHROPIC_API_KEY to CI environment variables" (web UI direct commit to master, unauthorized by plan)
- `e4c080c` — "Disable push and pull request triggers in CI" (web UI direct commit to master, unauthorized by plan)

Both were reverted and squashed into PR #32. They do not affect the live codebase.

## Must-Haves Verification

| Truth | Status | Evidence |
|-------|--------|----------|
| Direct push to master is rejected (branch protection active) | PASS with admin-bypass note | `f1e224f` push succeeded with explicit GitHub admin-bypass warning ("Bypassed rule violations for refs/heads/master") — correct behavior for `enforce_admins: false`. Non-admin contributors are blocked. |
| Force-push to master is rejected | PASS | Pete confirmed force-push attempt was properly rejected ("Cannot force-push to this branch"). `allow_force_pushes.enabled: false` confirmed in snapshot. |
| PR merge requires `test (20)`, `test (22)`, `Analyze` | PASS | Snapshot `required_status_checks.contexts = ["test (20)", "test (22)", "Analyze"]`. UI re-audit confirmed all three status checks listed. "Require branches to be up to date" CHECKED. |
| `UAT Accuracy Tests` is NOT a required check | PASS | Snapshot `required_status_checks.contexts` does not contain `UAT Accuracy Tests`. UI confirmed UAT not listed. Correct — UAT runs on schedule/dispatch, never on PRs. |
| Snapshot committed at `.planning/phases/17-uat-ci-infrastructure/branch-protection-snapshot.json` | PASS | File exists and parses as valid JSON. Confirmed in PR #32 squash commit. |

## Task 2 Human Verification Outcome

Pete verified all four checkpoint steps with the following results:

**Step 1 — ANTHROPIC_API_KEY secret:** PASS  
Secret added to GitHub Actions repo secrets list. Confirmed visible by name (value hidden per GitHub convention).

**Step 2 — UAT workflow smoke run:** DEFERRED (v1.4 tail item)  
`uat.yml` confirmed present on origin (`gh api repos/.../contents/.github/workflows/uat.yml` — 1664B, SHA `47106cffdb79cd858e77a4759cb9ee315e63fbd5`). Pete will trigger `gh workflow run uat.yml` at a later session. This is the only item not completed in this plan.

**Step 3 — GitHub UI branch protection re-audit:** PASS  
Full UI re-audit confirmed all 8 settings correct:
- "Require a pull request before merging" — CHECKED (added in PR #32 fix)
- Status checks: `test (20)`, `test (22)`, `Analyze` listed
- `UAT Accuracy Tests` NOT listed (intentional)
- "Require branches to be up to date before merging" — CHECKED
- "Allow force pushes" — UNCHECKED
- "Allow deletions" — UNCHECKED

**Step 4 — Branch protection smoke test:** PASS with admin-bypass note  
Direct push to master (`f1e224f` empty commit) proceeded with GitHub's explicit admin-bypass warning — not silently. Force-push was properly rejected. This is correct behavior for `enforce_admins: false`: repo owner can bypass in emergencies with a visible warning; non-admin contributors and all force-push attempts are hard-blocked.

## Admin-Bypass Design Rationale

`enforce_admins: false` is a deliberate tradeoff for a solo-developer repo. Pete is the sole admin and sole contributor. The protection satisfies BRANCH-PROT-01 for the intended use case: blocking accidental direct pushes, blocking force-pushes from all users (including admin), and requiring CI to pass for PR merges.

The admin-bypass exists for genuine emergency situations (e.g., a broken CI gate preventing a critical hotfix). The bypass is not silent — GitHub surfaces an explicit warning in the push response and in the commit history. This is documented in `branch-protection-snapshot.json` under `enforce_admins.enabled: false`.

This matches the design rationale in the plan: "Pete is the sole admin and may need emergency push access (e.g., to fix a broken master after a hook failure)."

## Deviations from Plan

**1. [Rule 1 - Bug] Original `gh api` payload omitted `required_pull_request_reviews`**
- **Found during:** Task 2 UI audit (post-merge)
- **Issue:** The initial Task 1 `gh api` PUT call sent `"required_pull_request_reviews": null`, which the GitHub API interpreted as "no PR review settings" — but the UI showed "Require a pull request before merging" as unchecked. After the fix, `required_pull_request_reviews` was sent as an object (with `required_approving_review_count: 0`), which correctly sets the rule without requiring a second reviewer.
- **Fix:** Follow-up commit added `required_pull_request_reviews` as a proper object to the payload. Both commits squashed into PR #32.
- **Files modified:** `.planning/phases/17-uat-ci-infrastructure/branch-protection-snapshot.json` (re-captured after fix)
- **Commit:** Squashed into `19e8037`

**2. Two unauthorized direct-to-master web UI commits appeared and were reverted**
- **Found during:** Task 2 verification audit
- **Issue:** Commits `b33ca14` ("Add ANTHROPIC_API_KEY to CI environment variables") and `e4c080c` ("Disable push and pull request triggers in CI") were created via GitHub web UI directly to master, outside the GSD workflow.
- **Fix:** Both reverted and squashed into PR #32. The live codebase reflects the correct state.
- **Files modified:** `.github/workflows/ci.yml` (reverted to correct state)
- **Commit:** Squashed into `19e8037`

## Deferred Items

| Item | Status | Who | When |
|------|--------|-----|------|
| UAT workflow smoke run (`gh workflow run uat.yml`) | Deferred to v1.4 tail | Pete | Next available session |
| Download and inspect `uat-accuracy-report.txt` artifact | Blocked on smoke run | Pete | After smoke run completes |

The smoke run is the only item preventing a full "APPROVED" status on the phase-level success criterion #1 (workflow runs UAT tests). All other success criteria are satisfied.

## Branch Protection Snapshot Reference

Key fields from `.planning/phases/17-uat-ci-infrastructure/branch-protection-snapshot.json`:

```json
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["test (20)", "test (22)", "Analyze"]
  },
  "enforce_admins": { "enabled": false },
  "allow_force_pushes": { "enabled": false },
  "allow_deletions": { "enabled": false },
  "required_pull_request_reviews": {
    "required_approving_review_count": 0
  }
}
```

## Requirements Satisfied

- **BRANCH-PROT-01:** Branch protection on master enforcing CI + blocking force-push — SATISFIED (admin-bypass note documented)

## Known Stubs

None. The plan produced one artifact (`branch-protection-snapshot.json`) which is complete and correct.

## Self-Check: PASSED

- [x] `.planning/phases/17-uat-ci-infrastructure/branch-protection-snapshot.json` exists and contains valid JSON with correct `required_status_checks.contexts`
- [x] Snapshot `allow_force_pushes.enabled: false` — confirmed
- [x] Snapshot `allow_deletions.enabled: false` — confirmed
- [x] Snapshot `required_status_checks.strict: true` — confirmed
- [x] Snapshot does NOT contain `UAT Accuracy Tests` in contexts — confirmed
- [x] Commit `19e8037` exists in git log — confirmed
- [x] Commit `f1e224f` exists in git log — confirmed
- [x] Branch: `chore/v1.4-phase-17-closeout` — confirmed
- [x] All must-haves verified with evidence from Pete's human checkpoint response
- [x] Deferred item (smoke run) documented clearly
