---
phase: 28-surface-completion
plan: 02
subsystem: infra
tags: [git-hooks, docsync, pre-push, jest]

requires:
  - phase: 24-doc-sync-agent
    provides: post-merge-doc-sync.js exports (extractDocStats, compareStats, getLiveStats)
provides:
  - Blocking pre-push docs-drift gate (hooks/pre-push-docsync.js)
  - Non-destructive behind/diverged remedy in hooks/pre-push
affects: [ci, docsync, git-hooks]

tech-stack:
  added: []
  patterns: ["Pure evaluate() function separated from process.exit CLI shell — mirrors post-merge-doc-sync.js's testable/CLI split"]

key-files:
  created:
    - hooks/pre-push-docsync.js
    - test/hooks/pre-push-docsync.test.js
  modified:
    - hooks/pre-push

key-decisions:
  - "Reused post-merge-doc-sync.js's extractDocStats/compareStats/getLiveStats via require — no duplicated regex logic"
  - "evaluate() computes warnings as (drift at warn threshold) minus (drift at block threshold) by string diff, avoiding a second violation-classification code path"
  - "Replaced git reset --hard remedy with git merge-base --is-ancestor to distinguish behind (safe ff-pull) from ahead/diverged (never touch local commits)"

requirements-completed: [REQ-SURF-02]

duration: 25min
completed: 2026-07-15
---

# Phase 28 Plan 02: Pre-Push Docsync Gate + Destructive Remedy Fix Summary

**Added a blocking pre-push docs-drift gate reusing existing post-merge-doc-sync machinery, and replaced `hooks/pre-push`'s `git reset --hard` remedy with a non-destructive `merge-base --is-ancestor` check.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3 completed
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- `hooks/pre-push-docsync.js` blocks a push when CLAUDE.md/README.md test-count or coverage stats have drifted from live jest output beyond `config/docsync.json`'s `block_threshold_pct`; warns (non-blocking) below that; never blocks on a jest crash; `SKIP_DOCSYNC=1` bypasses it.
- `hooks/pre-push` now uses `git merge-base --is-ancestor master origin/master` to tell behind (safe `git pull --ff-only`) from ahead/diverged (never touch local commits) — closing the gap that would have recommended `git reset --hard origin/master` and destroyed session 61's unpushed commit.
- Verified live against the actual worktree state: the hook correctly detected local master ahead of origin/master and printed the non-destructive reconcile message (no `reset --hard` anywhere in output or script).

## Task Commits

1. **Task 1: Create hooks/pre-push-docsync.js blocking gate** - `7b56931` (feat)
2. **Task 2: Test the docsync gate (block / warn / skip)** - `7fadd70` (test)
3. **Task 3: Wire docsync into hooks/pre-push and fix the destructive remedy** - `f2b5a9a` (fix)

## Files Created/Modified
- `hooks/pre-push-docsync.js` - Blocking docsync gate; exports `evaluate(docStats, liveStats, config)` (pure) and `main()` (CLI, exit-code driven)
- `test/hooks/pre-push-docsync.test.js` - 5 unit tests covering block/warn/synced/default-threshold cases for `evaluate`
- `hooks/pre-push` - Feature-branch stale-base remedy now branches on `is-ancestor`; docsync step runs before `exit 0`, skippable via `SKIP_DOCSYNC`

## Deviations from Plan

None — plan executed exactly as written. One correction made during verification: the plan's suggested phrase "never git reset --hard" for the ahead/diverged remedy message would itself have contained the literal string `reset --hard`, which the plan's own verify grep (`! grep -q "reset --hard"`) disallows. Reworded to "do not discard local commits" / "not safe to force it to match origin" to preserve the same warning without the disallowed substring. This is a wording-only fix within Task 3's own file, not a deviation from Task 3's intent.

## Self-Check: PASSED

- FOUND: hooks/pre-push-docsync.js
- FOUND: test/hooks/pre-push-docsync.test.js
- FOUND: hooks/pre-push (modified)
- FOUND commit 7b56931
- FOUND commit 7fadd70
- FOUND commit f2b5a9a
