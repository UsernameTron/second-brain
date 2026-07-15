---
phase: 27-context-honesty
plan: 01
subsystem: infra
tags: [jest, hooks, sessionstart, documentation-drift]

# Dependency graph
requires: []
provides:
  - "checkStaleness(content, now) pure function warning when CLAUDE.md's `Last verified:` date is >14 days old"
  - "SessionStart hook (.claude/hooks/staleness-check.js) registered in .claude/settings.json, warn-only, always exits 0"
affects: [27-context-honesty (REQ-CTX-03 authority hierarchy work in this phase), future sync-docs tooling]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Non-blocking SessionStart hook: pure-function core exported for Jest, thin require.main === module entrypoint that always process.exit(0)"

key-files:
  created:
    - .claude/hooks/staleness-check.js
    - test/staleness-check.test.js
  modified:
    - .claude/settings.json

key-decisions:
  - "14-day threshold is strictly-greater-than (14 days old = fresh, 15 = stale), per plan spec"
  - "Missing/unparseable Last verified: line always warns rather than assuming freshness — matches 'stale by definition' framing in REQ-CTX-01"

patterns-established:
  - "Hook verification workaround: package.json testPathIgnorePatterns excludes .claude/worktrees, so tests in a worktree checkout must be run with an explicit --testPathIgnorePatterns='/node_modules/' CLI override rather than the bare npm test script"

requirements-completed: [REQ-CTX-01]

# Metrics
duration: 12min
completed: 2026-07-15
---

# Phase 27 Plan 01: SessionStart Staleness Hook Summary

**Warn-only SessionStart hook (`checkStaleness`) flags a CLAUDE.md `Last verified:` date older than 14 days, printing the file name and age without ever blocking a session.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-15T21:15:03Z
- **Completed:** 2026-07-15T21:17:46Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- `checkStaleness(content, now)` pure function: regex-parses `> Last verified: YYYY-MM-DD`, returns `null` when fresh (<=14 days) and a warning string when stale (>14 days) or when the date is missing/unparseable.
- Hook entrypoint reads `CLAUDE.md` from `CLAUDE_PROJECT_DIR` (falling back to `cwd`), never throws, and always `process.exit(0)`.
- 6 Jest cases covering fresh (0 days), the 14-day boundary, 15-day stale, the historical 77-day audit case, a missing status line, and empty/undefined content.
- Hook registered under a new `SessionStart` array in `.claude/settings.json`, alongside the existing `PostToolUse`/`PreToolUse` blocks (untouched).

## Task Commits

Each task was committed atomically:

1. **Task 1: Write staleness-check.js core + Jest tests** - `5056d25` (feat)
2. **Task 2: Register the hook in settings.json SessionStart** - `6205d01` (feat)

_TDD task 1 was implemented directly with full coverage written alongside the core (behavior spec in the plan was exhaustive enough to write core + tests together and verify green in one pass; no red-then-green iteration was needed beyond the single verification run)._

## Files Created/Modified
- `.claude/hooks/staleness-check.js` - `checkStaleness` core + non-blocking SessionStart entrypoint
- `test/staleness-check.test.js` - 6 Jest cases (fresh, boundary, stale, historical, missing, empty)
- `.claude/settings.json` - new `SessionStart` hook array invoking `node $CLAUDE_PROJECT_DIR/.claude/hooks/staleness-check.js`

## Decisions Made
- Followed the plan's exact regex, threshold, and message-format spec — no deviation on the core logic.
- Verified `.claude/hooks/**` linting is out of scope for `npm run lint` (`eslint src/ test/`) and that the existing `memory-extraction-hook.js` precedent produces the identical `no-undef` (require/process/module) errors when linted directly — confirmed this is a pre-existing repo-wide convention, not a regression introduced here, so no eslint-disable or config change was added.

## Deviations from Plan

None — plan executed exactly as written. One environment note, not a deviation:

- `package.json`'s `jest.testPathIgnorePatterns` includes `.claude/worktrees`, and this plan's execution happens inside a worktree checkout (`.claude/worktrees/agent-a893b05c11d1a8fd0/`). Running the plan's literal verify command (`CI=true npx jest test/staleness-check.test.js -x`) fails two ways: `-x` isn't a recognized Jest 30 CLI flag (should be `--bail`), and the bare command finds 0 matching tests because every path in a worktree checkout contains the ignore substring. Verified instead with `CI=true npx jest test/staleness-check.test.js --testPathIgnorePatterns='/node_modules/'`, which overrides the ignore list for this invocation only — no repo config was changed. All 6 tests pass.

## Issues Encountered
None beyond the Jest CLI/worktree-path note above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- REQ-CTX-01 complete. Remaining v1.6 Context Honesty work: REQ-CTX-03 (authority hierarchy), REQ-SURF-01/02, tracked in STATE.md Next Action.
- No blockers introduced. The unprotected `master` branch-protection regression (noted in STATE.md) remains open and is unrelated to this plan.

---
*Phase: 27-context-honesty*
*Completed: 2026-07-15*

## Self-Check: PASSED

- FOUND: .claude/hooks/staleness-check.js
- FOUND: test/staleness-check.test.js
- FOUND: .planning/phases/27-context-honesty/27-01-SUMMARY.md
- FOUND commit: 5056d25
- FOUND commit: 6205d01
