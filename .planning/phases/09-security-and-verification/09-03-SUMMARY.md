---
phase: 09-security-and-verification
plan: "03"
subsystem: config-validation
tags: [security, validation, ajv, json-schema, skill]
dependency_graph:
  requires: []
  provides: [config-validator-skill, config-validator-engine]
  affects: [ship-pipeline, pre-flight-checks]
tech_stack:
  added: ["ajv@^8.18.0"]
  patterns: [schema-driven-discovery, warning-not-error-for-missing-files]
key_files:
  created:
    - src/config-validator.js
    - test/config-validator.test.js
    - .claude/skills/config-validator/SKILL.md
  modified:
    - package.json
    - .gitignore
decisions:
  - "AJV 8 (draft-07 default) chosen — matches existing schema $schema declarations and is the current LTS major"
  - "Schema-driven discovery (not config-driven) — silently skips configs without schemas as required by D-19"
  - "WARNING status for missing config files, not ERROR — aligns with D-18 decision for memory-categories.json"
  - "Exit code 0 for PASS+WARNING, exit code 1 for FAIL+ERROR — clean signal for CI/pre-flight gates"
metrics:
  duration_seconds: 260
  completed_date: "2026-04-23"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 2
  tests_added: 12
---

# Phase 9 Plan 03: Config/Schema Validation Skill Summary

AJV-based config validation engine with schema-driven discovery, WARNING-not-error for missing files, and a Claude skill definition for on-demand invocation.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Install ajv + create config-validator.js with tests | 8777b83 | src/config-validator.js, test/config-validator.test.js, package.json |
| 2 | Create config-validator skill | e18f08a | .claude/skills/config-validator/SKILL.md, .gitignore |

## Decisions Made

1. **AJV 8 (draft-07)** — Matches `$schema: http://json-schema.org/draft-07/schema#` in all four existing schemas. AJV 8 supports draft-07 natively with its default meta-schema. No migration needed.

2. **Schema-driven discovery** — `validateAll()` globs `config/schema/*.schema.json` to build the validation list, not `config/*.json`. This means configs with no schema (excluded-terms, scheduling, vault-paths) are silently skipped without enumeration. Matches D-19.

3. **WARNING for missing config** — memory-categories.schema.json exists but memory-categories.json does not (per D-18). Returning WARNING (not ERROR) keeps CLI exit code 0, so the missing file doesn't break the ship pipeline while the schema is held for future use.

4. **AJV `$id` uniqueness** — Each schema is compiled with a file-path-based `$id` to prevent AJV's internal cache from conflicting across test runs that write different schemas to the same relative path.

5. **.gitignore whitelist for `.claude/skills/`** — The existing .gitignore whitelisted `.claude/hooks/`, `.claude/agents/`, and `.claude/settings.json` but not `.claude/skills/`. Added whitelist entry so the skill file is version-controlled with the rest of the project.

## Verification Results

| Check | Result |
|-------|--------|
| `npm install` (ajv available) | PASS |
| `node src/config-validator.js` exits 0 | PASS |
| connectors.json → PASS | PASS |
| pipeline.json → PASS | PASS |
| templates.json → PASS | PASS |
| memory-categories.json → WARNING | PASS |
| excluded-terms/scheduling/vault-paths silently skipped | PASS |
| `npx jest test/config-validator.test.js` (12/12 tests) | PASS |
| `.claude/skills/config-validator/SKILL.md` exists with correct frontmatter | PASS |
| Full test suite (`npm test`) — 2747 tests, 131 suites | PASS |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Config] .gitignore did not whitelist `.claude/skills/`**

- **Found during:** Task 2 commit
- **Issue:** `.gitignore` had `.claude/*` with whitelists for hooks, agents, and settings.json — but not skills. `git add .claude/skills/config-validator/SKILL.md` was rejected.
- **Fix:** Added `!.claude/skills/` to the .gitignore whitelist, consistent with the existing pattern for hooks and agents.
- **Files modified:** `.gitignore`
- **Commit:** e18f08a

## Known Stubs

None — all code paths are fully implemented. Validation engine handles PASS, FAIL, WARNING, and ERROR cases with real logic.

## Self-Check: PASSED
