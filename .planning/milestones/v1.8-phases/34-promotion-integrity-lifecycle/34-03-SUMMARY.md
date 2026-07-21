---
phase: 34-promotion-integrity-lifecycle
plan: 03
subsystem: infra
tags: [verification, pre-push-hooks, memory, sentinel-check]

requires: []
provides:
  - "eval/baseline-sentinel-hashes.json — the real 27 content_hash values from memory.md.pre-governance.20260712, committed as a repo fixture"
  - "scripts/verify-baseline.js — real, exit-coded baseline-integrity check (npm run verify:baseline)"
  - "hooks/pre-push baseline-integrity gate (SKIP_BASELINE=1 bypass)"
affects: [milestone-reporting, promotion-integrity-lifecycle]

tech-stack:
  added: []
  patterns: ["VAULT_ROOT-testable CLI scripts with real process.exit codes, matching scripts/eval-recall.js precedent", "pre-push gate blocks matching hooks/pre-push-docsync.js structure"]

key-files:
  created:
    - eval/baseline-sentinel-hashes.json
    - scripts/verify-baseline.js
    - test/verify-baseline.test.js
  modified:
    - package.json
    - hooks/pre-push

key-decisions:
  - "Located memory.md.pre-governance.20260712 at ~/Claude Cowork/archive/memory-snapshots/ (not in repo, not in ~/.cache/second-brain/) — extracted 27 real content_hash values, matching the 2026-07-19 audit count exactly."
  - "verify-baseline.js reads memory.md ∪ every memory-archive/*.md file (union, matching the plan's resolution-set definition), not a fixed live/archive split."

requirements-completed: [VERIFY-SENTINEL-01]

duration: ~25min
completed: 2026-07-20
---

# Phase 34 Plan 03: Real Sentinel-Hash Baseline Check Summary

**Replaced the fabricated "3/3 sentinel hashes verified" claim with a real, exit-coded `scripts/verify-baseline.js` check against 27 committed content_hash values, wired into the pre-push gate.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3/3 completed
- **Files modified:** 5 (2 created config/fixture, 2 created code/test, 2 modified)

## Accomplishments
- Located the real backup file and extracted all 27 sentinel hashes as a committed JSON fixture — no fabrication.
- `scripts/verify-baseline.js` gives baseline integrity a real pass/fail exit code (0 = all resolve, 1 = any missing, with the missing hashes printed).
- Wired into `hooks/pre-push` with `SKIP_BASELINE=1` bypass, mirroring the existing docsync gate.

## Baseline Artifact Location

`memory.md.pre-governance.20260712` was found at:

```
~/Claude Cowork/archive/memory-snapshots/memory.md.pre-governance.20260712
```

It is NOT in the repo checkout and NOT under `~/.cache/second-brain/` — it lives in the vault's own snapshot archive dir. Extracted via `grep -oE "content_hash:: [0-9a-f]{12}"`: **27 unique hashes, no duplicates, file order preserved.** This matches the 2026-07-19 audit exactly (18 resolve live in `memory.md`, 9 in `memory-archive/`).

## Task Commits

Each task was committed atomically (`--no-verify`, parallel-worktree execution):

1. **Task 1: Extract the 27 sentinel hashes into a committed fixture** - `7240e00` (chore)
2. **Task 2: verify-baseline.js with real exit code + npm script + tests** - `fc23304` (feat)
3. **Task 3: Wire verify-baseline into the pre-push docs gate** - `095d48f` (chore)

## Files Created/Modified
- `eval/baseline-sentinel-hashes.json` - the 27 real content_hash values + source/captured metadata
- `scripts/verify-baseline.js` - reads the fixture, checks each hash against `$VAULT_ROOT/memory/memory.md` ∪ `$VAULT_ROOT/memory-archive/*.md`, prints `N/27 baseline hashes resolve`, exits 0/1
- `test/verify-baseline.test.js` - subprocess tests (exit 0 all-present, exit 1 one-missing + prints missing hash, VAULT_ROOT override honored) — subprocess pattern required because the script calls `process.exit` directly (same pattern as `test/compounding-report.test.js`)
- `package.json` - added `"verify:baseline": "node scripts/verify-baseline.js"`
- `hooks/pre-push` - added baseline-integrity gate block after the docsync gate, with `SKIP_BASELINE=1` bypass

## Verification Performed (literal acceptance criteria + coordinator follow-up)

- `node -e "...hashes.length===27 && all /^[0-9a-f]{12}$/"` → **PASS**
- `grep -n "verify:baseline" package.json` → matches (line 18)
- `grep -n "process.exit" scripts/verify-baseline.js` → matches (line 58)
- `npx jest test/verify-baseline.test.js` → **3/3 tests passed**
- `VAULT_ROOT=~/Claude\ Cowork node scripts/verify-baseline.js` → `27/27 baseline hashes resolve`, **exit 0**
- Deliberately-corrupted copy (temp VAULT_ROOT = copy of real vault with one sentinel `content_hash::` line stripped) → `26/27 baseline hashes resolve` / `Missing: a7a306669452`, **exit 1**
- `grep -n "verify-baseline" hooks/pre-push` → matches
- `grep -n "SKIP_BASELINE" hooks/pre-push` → matches
- `bash -n hooks/pre-push` → exit 0 (valid shell)

## Decisions Made
- Fixture resolution set is a union scan (`memory.md` + every `.md` under `memory-archive/`), not a hardcoded split — matches the plan's stated resolution rule and survives archive files being added/renamed.
- `console.log` used freely in `scripts/verify-baseline.js` per the plan's explicit constraint (scripts/ are CLI entry points, not library modules, matching `scripts/eval-recall.js`).

## Deviations from Plan

None - plan executed exactly as written. The plan's TDD annotation on Task 2 called for RED→GREEN commit separation; this was executed as a single commit (script + test together) after both were written and verified — no separate failing-test commit exists. Documented here as the one procedural deviation; behavior and acceptance criteria are unaffected (all 3 acceptance-criteria checks for Task 2 pass).

## Issues Encountered
- The worktree's `package.json` `jest.testPathIgnorePatterns` includes `.claude/worktrees`, which excludes this worktree's own test files when running plain `npx jest <file>` from inside the worktree. Worked around for verification with `--testPathIgnorePatterns="/node_modules/" --testPathPatterns=<abs-path>`; no code change needed, this is a pre-existing parallel-execution artifact, not a defect introduced by this plan.
- This worktree branched before `.planning/` docs were committed to the main repo, so `34-03-PLAN.md` was read by absolute path from the main checkout (read-only) rather than from the worktree.

## Next Phase Readiness
- VERIFY-SENTINEL-01 is closed: baseline integrity is now a real, run-backed, exit-coded check gated at pre-push.
- Ready for the orchestrator to merge this worktree's 3 commits and update ROADMAP.md/STATE.md/REQUIREMENTS.md (not touched by this agent per parallel-executor scope).

---
*Phase: 34-promotion-integrity-lifecycle*
*Completed: 2026-07-20*
