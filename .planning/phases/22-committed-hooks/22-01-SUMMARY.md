---
phase: 22-committed-hooks
plan: 01
status: complete
started: 2026-04-26T13:38:00.000Z
completed: 2026-04-26T13:48:00.000Z
---

# Plan 22-01 Summary: Pre-commit Schema Validation & Vault Boundary Hooks

## What Was Built

Git pre-commit hook infrastructure with two enforcement layers:

1. **Schema validation hook** (`hooks/pre-commit-schema-validate.js`): Validates `config/*.json` files against their corresponding JSON Schemas via AJV, and validates `daily-stats.md` YAML frontmatter against a new dedicated schema. Catches malformed config before it lands on master.

2. **Vault boundary hook** (`hooks/pre-commit-vault-boundary.js`): Blocks commits that include files under LEFT-side vault paths (ABOUT ME, Daily, Relationships, Drafts). Pure string comparison of first path segment against `config/vault-paths.json` LEFT array.

3. **Pre-commit orchestrator** (`hooks/pre-commit`): Shell script chaining both sub-hooks. Resolves paths correctly whether run directly or via `.git/hooks/` symlink.

4. **Daily-stats frontmatter schema** (`config/schema/daily-stats-frontmatter.schema.json`): JSON Schema requiring schema_version (string), columns (array of strings), timezone (string), last_updated (ISO datetime pattern).

## Key Files

### Created
- `hooks/pre-commit` — orchestrator shell script (executable)
- `hooks/pre-commit-schema-validate.js` — AJV schema validation hook
- `hooks/pre-commit-vault-boundary.js` — LEFT/RIGHT boundary enforcement
- `config/schema/daily-stats-frontmatter.schema.json` — daily-stats frontmatter schema
- `test/hooks/pre-commit-schema-validate.test.js` — 6 schema validation tests
- `test/hooks/pre-commit-vault-boundary.test.js` — 11 boundary tests

## Test Results

- 6 schema validation tests passing
- 11 vault boundary tests passing
- 17 total hook tests, 0 failures

## Deviations

- Used `execFileSync` instead of `execSync` for git commands in vault-boundary hook (safer — no shell injection risk)
- Orchestrator path resolution uses `readlink -f` with Python fallback instead of relative `../../hooks` path, making it work both directly and via symlink

## Self-Check: PASSED
