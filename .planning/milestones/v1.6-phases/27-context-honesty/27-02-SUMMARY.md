---
phase: 27-context-honesty
plan: 02
subsystem: docs
tags: [governance, memory, authority, reach-exporter, adr]

# Dependency graph
requires:
  - phase: 27-context-honesty (plan 01)
    provides: SessionStart staleness-check hook (REQ-CTX-01), so the CLAUDE.md comment this plan updates is accurate
provides:
  - "ADR-020: written authority hierarchy ranking the four current stores"
  - "Hierarchy one-liner carried in every reach-exported pointer file (src/reach-exporter.js)"
  - "Router pointers to ADR-020 in project CLAUDE.md and ~/Claude Cowork/CLAUDE.md"
affects: [28-surface-completion, any future ~/memory/ canon bootstrap milestone]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ADR shape: Status/Context/Decision/Rationale/Scope/Consequences/Provenance (mirrors ADR-018/019)"
    - "CLAUDE.md as router only — facts live in ADRs/memory.md, CLAUDE.md links to them"

key-files:
  created:
    - decisions/ADR-020-authority-hierarchy.md
  modified:
    - src/reach-exporter.js
    - test/reach-exporter.test.js
    - CLAUDE.md
    - /Users/cpconnor/Claude Cowork/CLAUDE.md (outside repo)

key-decisions:
  - "Ranking fixed as ABOUT ME/ canon > memory.md > CLAUDE.md > auto-memory blob, with all six pairwise winners stated explicitly (no 'it depends' case)"
  - "Rule-4 (live Pete outranks stale canon) is the load-bearing rule carried over from .planning/research/AUTHORITY.md — flagged in-session, never silently resolved either direction"
  - "Router pointer placed adjacent to the existing Reach layer paragraph in CLAUDE.md (no '## Memory' heading exists in this project's CLAUDE.md; the plan's read_first assumed one)"

patterns-established:
  - "New ADRs adapt-not-redesign from .planning/research/ — this is the second ADR (after ADR-019) to do so explicitly and cite the source doc in Provenance"

requirements-completed: [REQ-CTX-03]

# Metrics
duration: ~11min (task work; excludes environment/plan-recovery time)
completed: 2026-07-15
---

# Phase 27 Plan 02: Authority Hierarchy (ADR-020) Summary

**Written authority hierarchy (ADR-020) ranking ABOUT ME/ canon > memory.md > CLAUDE.md > auto-memory blob, wired into the reach-exporter pointer template and both CLAUDE.md router files.**

## Performance

- **Duration:** ~11 min task execution (16:14 plan-recovery start to 16:25 last commit)
- **Completed:** 2026-07-15
- **Tasks:** 3 completed
- **Files modified:** 4 in-repo (+ 1 outside-repo)

## Accomplishments
- `decisions/ADR-020-authority-hierarchy.md` created: ranks all four stores, states all six pairwise winners, carries Rule-4 (live Pete outranks stale canon, flagged not silently resolved)
- `src/reach-exporter.js` `renderReachFile` now emits an `**Authority:**` line referencing ADR-020 in every generated cross-surface pointer file; regression test added
- Project `CLAUDE.md` gets a one-line router pointer to ADR-020 (asserts no new fact) and its line-23 staleness-hook comment is now present-tense-accurate (27-01 shipped the hook)
- `~/Claude Cowork/CLAUDE.md` (outside repo) gets the same hierarchy one-liner, added idempotently

## Task Commits

Each task was committed atomically:

1. **Task 1: Write ADR-020 authority hierarchy** - `11f99c2` (docs)
2. **Task 2: Add hierarchy one-liner to the reach pointer template + regression test** - `38a1d08` (feat)
3. **Task 3: Router pointer in project CLAUDE.md + hierarchy one-liner in Cowork CLAUDE.md** - `8bffeb9` (docs)

_Cowork CLAUDE.md is outside the repo and not committed to this repo's history — it was edited directly at `/Users/cpconnor/Claude Cowork/CLAUDE.md`._

## Files Created/Modified
- `decisions/ADR-020-authority-hierarchy.md` - normative authority hierarchy, six pairwise winners, Rule-4
- `src/reach-exporter.js` - `renderReachFile` template gains the Authority one-liner
- `test/reach-exporter.test.js` - regression test asserting ADR-020 + ranking substring in rendered output
- `CLAUDE.md` - router pointer to ADR-020; line-23 comment updated to present tense
- `/Users/cpconnor/Claude Cowork/CLAUDE.md` (outside repo) - hierarchy one-liner added idempotently

## Decisions Made
- Placed the CLAUDE.md router pointer immediately after the existing "Reach layer" paragraph (under `## Commands`) rather than a "## Memory" section — this project's CLAUDE.md has no such heading; the plan's `read_first` note assumed one that doesn't exist here. Same effect (adjacent to the existing memory/reach content), no new section created.
- No other deviations — ADR content, reach-exporter line, and both CLAUDE.md edits match the plan's exact specified text.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `27-02-PLAN.md` did not exist in this worktree at start**
- **Found during:** Startup, before Task 1
- **Issue:** This worktree's branch was created before the phase-27 planning commits (`b1dddf6`, `7a05ae9`) landed on the main repo checkout's local `master`. `27-CONTEXT.md` alone was reachable via a clean fast-forward; the three `27-0N-PLAN.md` files sat on an unmerged local branch (`chore/session-64-wrap`) off a commit (`7a05ae9`) not yet on `master`.
- **Fix:** `git merge --ff-only master` (clean fast-forward, no divergence) to pick up 27-01 execution + `27-CONTEXT.md`, then `git cherry-pick 7a05ae9` (the standalone planning commit, verified as a clean child of already-merged history) to bring in `27-01/02/03-PLAN.md` and the ROADMAP heading update. Both operations were non-destructive (fast-forward + clean cherry-pick, no conflicts, no rewritten history).
- **Files affected:** none in scope of this plan's tasks — this only restored planning inputs already authored and committed elsewhere in the same repo.
- **Verification:** `27-02-PLAN.md` present and readable after the merge/cherry-pick; git log confirms both operations were fast-forward/clean.
- **Committed in:** `5f94ad5` (pre-existing commit, cherry-picked as-is, not authored by this run)

**2. [Rule 1 - Bug] Regression test assertion didn't match rendered template text**
- **Found during:** Task 2 verification (`CI=true npx jest test/reach-exporter.test.js`)
- **Issue:** First test assertion expected the substring `` `ABOUT ME/` > `memory.md` `` but the actual rendered line reads `` `ABOUT ME/` canon > `memory.md` > `CLAUDE.md` `` (the word "canon" sits between the backtick and `>`).
- **Fix:** Corrected the test assertion to match the actual rendered substring.
- **Files modified:** `test/reach-exporter.test.js`
- **Verification:** `CI=true npx jest test/reach-exporter.test.js --forceExit` — 22/22 passing
- **Committed in:** `38a1d08` (part of Task 2 commit)

**3. [Rule 3 - Blocking] Worktree-local jest config ignores test paths containing `.claude/worktrees`**
- **Found during:** Task 2 verification
- **Issue:** `package.json`'s `jest.testPathIgnorePatterns` includes `.claude/worktrees`, and this run's cwd is itself under `.claude/worktrees/agent-aa4746d9028506f6b/` — so every test path matched the ignore pattern and jest reported "0 matches" / "No tests found." This is a pre-existing repo config (protects the main checkout from picking up worktree-duplicated tests) that backfires when jest is invoked from inside a worktree.
- **Fix:** Ran the verification command with a CLI override (`--testPathIgnorePatterns="/node_modules/"`) for this invocation only. Did not touch `package.json` (shared config, out of this plan's scope, would need to be checked against all worktrees' consumers first).
- **Files modified:** none (CLI-only override, not persisted)
- **Verification:** `CI=true npx jest test/reach-exporter.test.js --forceExit --testPathIgnorePatterns="/node_modules/"` — 22/22 passing
- **Committed in:** N/A (verification-only, no file change)

---

**Total deviations:** 3 (1 blocking — missing plan inputs, restored via clean git ops; 1 bug — test assertion typo, self-caught and fixed; 1 blocking — jest config workaround, CLI-only, no shared-file edit)
**Impact on plan:** All three were prerequisites for executing the plan as written or for verifying Task 2 as instructed; none touched files outside this plan's declared `files_modified` scope, and none altered shared config.

## Issues Encountered
- See Deviations above (git recovery, test-assertion fix, jest ignore-pattern workaround). No unresolved issues.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- REQ-CTX-03 complete: authority hierarchy is written, wired into the reach pointer template, and both CLAUDE.md router files point at it.
- 27-03 (remaining phase-27 plan, per `27-03-PLAN.md`) and Phase 28 (Surface Completion, REQ-SURF-01/02) are unblocked by this plan.
- Flag for the orchestrator: this worktree was behind the main repo checkout's local `master` at start (see Deviation 1) — worth confirming other in-flight worktrees for this phase aren't similarly stale before merging.

---
*Phase: 27-context-honesty*
*Completed: 2026-07-15*

## Self-Check: PASSED

All created/modified files confirmed present on disk (`decisions/ADR-020-authority-hierarchy.md`, `src/reach-exporter.js`, `test/reach-exporter.test.js`, `CLAUDE.md`, `/Users/cpconnor/Claude Cowork/CLAUDE.md`, this SUMMARY). All three task commits (`11f99c2`, `38a1d08`, `8bffeb9`) confirmed in `git log`.
