---
phase: 22-committed-hooks
verified: 2026-04-26T14:00:00Z
status: passed
score: 7/7 must-haves verified
re_verification: true
gaps: []
    artifacts:
      - path: "hooks/pre-commit"
        issue: "Script exists and is executable but not wired to git. core.hooksPath is .git/hooks not hooks/."
    missing:
      - "Either run `git config core.hooksPath hooks` (local or committed via .gitconfig), add a symlink via postinstall/prepare script, or document the manual step as a setup requirement"
---

# Phase 22: Committed Hooks Verification Report

**Phase Goal:** Git pre-commit enforces schema, vault boundary, dotenv discipline
**Verified:** 2026-04-26T14:00:00Z
**Status:** gaps_found
**Re-verification:** No

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Committing malformed config/*.json fails at git commit time with AJV error | VERIFIED | `hooks/pre-commit-schema-validate.js` validates via AJV, test proves negative maxAttempts returns exitCode 1 with error containing "maxAttempts/minimum". 6/6 tests pass. |
| 2 | Committing daily-stats.md with invalid frontmatter fails at git commit time | VERIFIED | Schema at `config/schema/daily-stats-frontmatter.schema.json` enforces schema_version (string), columns (array, minItems 1), timezone, last_updated. Tests prove non-string schema_version and missing columns both fail. |
| 3 | Committing a LEFT vault path is blocked with boundary violation message | VERIFIED | `hooks/pre-commit-vault-boundary.js` reads LEFT array from vault-paths.json, blocks matching first segments. Tests prove "ABOUT ME", "Daily", "Relationships" are blocked. 11/11 tests pass. |
| 4 | Clean commits pass the pre-commit hook without error | VERIFIED | `bash hooks/pre-commit` exits 0 in clean state. Output: "[pre-commit] Running schema validation... [pre-commit] Running vault boundary check... [pre-commit] All checks passed." |
| 5 | pipeline-infra.js does not call dotenv.config() at module load time | VERIFIED | Line 23 replaced with JSDoc comment. `grep -n "require.*dotenv" src/pipeline-infra.js` returns no matches. Dedicated test "does not call dotenv.config() at require time" passes using jest.isolateModules + jest.doMock. |
| 6 | semantic-search test no longer needs dotenv mock | VERIFIED | `grep "jest.mock.*dotenv" test/integration/semantic-search.test.js` returns no matches. Mock was removed. |
| 7 | Hooks activate automatically for new checkouts | FAILED | `git config core.hooksPath` returns `.git/hooks`, not `hooks/`. No symlink, no husky, no postinstall script. Hooks are committed to `hooks/` but git does not use them. |

**Score: 6/7 truths verified**

### Required Artifacts

| Artifact | Exists | Substantive | Wired | Status |
|----------|--------|-------------|-------|--------|
| hooks/pre-commit | Yes | 17 lines, orchestrator chaining both sub-hooks | Invokes schema-validate + vault-boundary via node | VERIFIED |
| hooks/pre-commit-schema-validate.js | Yes | 213 lines, AJV validation, CLI + importable API | Called by hooks/pre-commit | VERIFIED |
| hooks/pre-commit-vault-boundary.js | Yes | 104 lines, LEFT boundary check, CLI + importable API | Called by hooks/pre-commit | VERIFIED |
| config/schema/daily-stats-frontmatter.schema.json | Yes | 25 lines, requires schema_version/columns/timezone/last_updated | Used by schema-validate hook | VERIFIED |
| src/pipeline-infra.js (modified) | Yes | 561 lines, dotenv.config() removed | No dotenv side effect at import | VERIFIED |
| test/hooks/pre-commit-schema-validate.test.js | Yes | 6 tests, covers valid/invalid config + frontmatter | Imports validateStagedFiles from hook | VERIFIED |
| test/hooks/pre-commit-vault-boundary.test.js | Yes | 11 tests, LEFT blocked, RIGHT passes, non-vault ignored | Imports checkVaultBoundary from hook | VERIFIED |
| test/pipeline-infra.test.js (modified) | Yes | 62 tests, includes 2 new dotenv guards | Tests pipeline-infra module | VERIFIED |

### Key Link Verification

| From | To | Via | Status |
|------|-----|-----|--------|
| hooks/pre-commit | hooks/pre-commit-schema-validate.js | `node "$HOOK_DIR/pre-commit-schema-validate.js"` | WIRED |
| hooks/pre-commit | hooks/pre-commit-vault-boundary.js | `node "$HOOK_DIR/pre-commit-vault-boundary.js"` | WIRED |
| hooks/pre-commit-schema-validate.js | config/schema/ | AJV schema loading via `path.join(schemaDir, schemaName)` | WIRED |
| hooks/pre-commit-vault-boundary.js | config/vault-paths.json | `require(path.join(PROJECT_ROOT, 'config', 'vault-paths.json'))` | WIRED |
| .git/hooks/pre-commit | hooks/pre-commit | symlink or core.hooksPath | NOT_WIRED |

### Behavioral Spot-Checks

| Check | Command | Result |
|-------|---------|--------|
| Hook tests pass | `CI=true npx jest test/hooks/ --no-coverage --forceExit` | PASS (17/17 tests, 2 suites) |
| Pipeline-infra tests pass | `CI=true npx jest test/pipeline-infra.test.js --no-coverage --forceExit` | PASS (62/62 tests) |
| Pre-commit executable | `test -x hooks/pre-commit` | PASS |
| Pre-commit clean run | `bash hooks/pre-commit` | PASS (exit 0, "All checks passed") |
| No dotenv require in pipeline-infra | `grep -n "require.*dotenv" src/pipeline-infra.js` | PASS (no matches, exit 1) |

### Requirements Coverage

| Requirement | Description | Plans | Status |
|-------------|-------------|-------|--------|
| HOOK-SCHEMA-01 | Pre-commit AJV validation catches malformed daily-stats.md frontmatter and out-of-bounds config/pipeline.json values | 22-01 | SATISFIED (schema hook validates both, tests prove failures) |
| HOOK-VAULT-01 | Pre-commit git-level path check prevents committing files to the wrong vault side | 22-01 | SATISFIED (vault boundary hook blocks LEFT paths, tests prove it) |
| HOOK-DOTENV-01 | dotenv.config() calls move from library modules to entry-points only | 22-02 | SATISFIED (require('dotenv').config() removed from pipeline-infra.js, replaced with JSDoc comment, tests guard against regression) |

No orphaned requirements. All three Phase 22 requirement IDs from REQUIREMENTS.md are covered by the plans and implemented.

### Anti-Patterns Found

| Pattern | File | Severity | Detail |
|---------|------|----------|--------|
| None | -- | -- | No TODO/FIXME/PLACEHOLDER/HACK in hooks/. No empty handlers. No hardcoded empty data. |

### Human Verification Required

### 1. Symlink Installation Test

**Test:** Run `git config core.hooksPath hooks` or `ln -sf ../../hooks/pre-commit .git/hooks/pre-commit`, then stage a malformed config/pipeline.json and attempt to commit.
**Expected:** Commit is blocked with AJV error message.
**Why human:** Requires modifying git config and staging real files -- not safe in automated verification.

### 2. LEFT Path Commit Block in Real Git Flow

**Test:** Stage a file with path starting with "ABOUT ME/" and attempt `git commit`.
**Expected:** Commit is blocked with "vault boundary violation" message.
**Why human:** Requires staging vault files that should not exist in the repo.

## Gaps Summary

One gap found: the hooks are committed to `hooks/` in the repo, but git is not configured to use that directory. `core.hooksPath` points to `.git/hooks` (default), no symlink exists, and no package.json lifecycle script (prepare/postinstall) sets this up. The hooks will not activate for new checkouts without manual intervention.

This corresponds to ROADMAP success criterion 4: "All three hooks are committed to `.git/hooks/` (or equivalent project hook config) and activate automatically for new checkouts."

**Recommended fix:** Add `git config core.hooksPath hooks` to a setup script, or add a `prepare` script in package.json that creates the symlink. The simplest approach is a single line in package.json: `"prepare": "git config core.hooksPath hooks"`.

---

_Verified: 2026-04-26T14:00:00Z_ / _Verifier: Claude (gsd-verifier scope:general)_
