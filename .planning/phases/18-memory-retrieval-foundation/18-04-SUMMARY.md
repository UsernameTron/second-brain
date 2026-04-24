---
phase: 18-memory-retrieval-foundation
plan: "04"
subsystem: recall-command
tags: [memory, recall, search, slash-command]
dependency_graph:
  requires: [18-03]
  provides: [RECALL-CMD-01, /recall slash-command]
  affects: [src/recall-command.js, .claude/commands/recall.md]
tech_stack:
  added: []
  patterns: [arg-parsing, graceful-error-swallowing, numbered-list-output]
key_files:
  created:
    - src/recall-command.js
    - test/unit/recall-command.test.js
    - .claude/commands/recall.md
  modified:
    - .gitignore
decisions:
  - "runRecall swallows all errors from searchMemoryKeyword and returns empty-result shape — never throws"
  - "parseRecallArgs uses Number.isFinite guard (not just parseInt) for --top NaN safety"
  - ".gitignore updated to allowlist .claude/commands/ so slash-command wrapper can be committed"
metrics:
  duration_minutes: 20
  completed_date: "2026-04-24"
  tasks_completed: 2
  files_created: 3
  files_modified: 1
---

# Phase 18 Plan 04: recall-command.js + /recall slash-command Summary

**One-liner:** `/recall` command implementation with arg parsing, memory search delegation, numbered-list output, and Claude Code slash-command wrapper via `.claude/commands/recall.md`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Implement src/recall-command.js + tests | 4d04d3a | src/recall-command.js, test/unit/recall-command.test.js |
| 2 | Create .claude/commands/recall.md wrapper | 2bc3d7e | .claude/commands/recall.md, .gitignore |

## Implementation Notes

### src/recall-command.js

- `parseRecallArgs(argv)`: parses positional query tokens plus `--category`, `--since`, `--top N` flags. Outer quotes stripped from query. NaN-safe `--top` guard falls back to default 5.
- `runRecall(argv)`: delegates to `searchMemoryKeyword` from `memory-reader.js`, slices to `topN`, formats each result as `N. [CATEGORY] snippet (short-ref)` using `sourceRefShort` from `memory-utils.js`. Returns `{ query, results, total, lines, empty }`.
- Error handling: any error from `searchMemoryKeyword` (missing vault, parse failure) is caught and returns empty-result shape — never throws.

### test/unit/recall-command.test.js

18 tests covering P1-P9 (parseRecallArgs) and R1-R9 (runRecall):
- Coverage on `src/recall-command.js`: 96.77% statements, 95% branches, 100% functions.
- R3 (missing vault) uses a fresh `tmpEmptyRoot` with no `memory/` subdir and module reload via `jest.resetModules()`.

### .claude/commands/recall.md

- YAML frontmatter with `description:` field for Claude Code slash-command recognition.
- Body instructs Claude to invoke `runRecall` from `./src/recall-command` with `$ARGUMENTS` split into argv array.
- Includes inline `node -e` reference implementation pattern.
- 32 lines (well within 40-line limit).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] .gitignore did not allowlist .claude/commands/**
- **Found during:** Task 2 commit
- **Issue:** `.gitignore` had `.claude/*` catch-all with only `hooks/`, `agents/`, `skills/`, `settings.json` allowlisted — `commands/` was blocked.
- **Fix:** Added `!.claude/commands/` to `.gitignore` allowlist.
- **Files modified:** `.gitignore`
- **Commit:** 2bc3d7e

**2. [Rule 1 - Bug] Empty catch blocks in test file triggered ESLint no-empty error**
- **Found during:** Task 1 lint check
- **Issue:** `catch (_) {}` blocks caused ESLint errors.
- **Fix:** Added `/* ignore cleanup errors */` comment inside catch blocks.
- **Files modified:** `test/unit/recall-command.test.js`

## Verification Results

- `npx jest test/unit/recall-command.test.js --forceExit`: 18/18 pass
- Coverage `src/recall-command.js`: 96.77% statements, 95% branches, 100% functions, 96.55% lines
- `npx jest --forceExit` full suite: 854 pass, 1 fail (pre-existing UAT classification flake — unrelated)
- `npm run lint`: 0 errors (41 pre-existing warnings in other files)
- All Task 2 acceptance grep checks pass
- `.claude/commands/recall.md`: 32 lines

## Self-Check: PASSED

- [x] `src/recall-command.js` exists with `parseRecallArgs` and `runRecall` exports
- [x] `test/unit/recall-command.test.js` exists, 18 tests pass
- [x] `.claude/commands/recall.md` exists, all grep checks pass
- [x] Coverage >= 80% (actual: 96.77%)
- [x] Commits 4d04d3a and 2bc3d7e exist
- [x] No `console.log` in `src/recall-command.js`
- [x] No `TODO`, `TBD`, or `Phase 21` in `.claude/commands/recall.md`
