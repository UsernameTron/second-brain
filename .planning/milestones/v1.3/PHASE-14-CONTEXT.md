# Phase 14 — CI Hardening

**Phase:** 14
**Milestone:** v1.3 Review Remediation
**Status:** PENDING
**Dependencies:** Phase 12 (security-scan-gate fix needed for CI push to work cleanly)

## Scope

### ESLint (B-08 / R3)
- Add ESLint 9+ with flat config (`eslint.config.js`)
- Plugins: `@eslint/js` recommended, `eslint-plugin-jest`, `eslint-plugin-n` (node)
- Add `lint` script to package.json
- Add lint step to CI workflow (`.github/workflows/ci.yml`)
- Fix any lint violations before merging

### SAST via CodeQL (B-08 / R3)
- Create `.github/workflows/codeql.yml`
- Language: javascript
- Triggers: push to master + weekly cron schedule
- Default query suite (security-extended)

### License checker
- Add license-checker CI step
- Permissive-only allowlist: MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, CC0-1.0
- Fail CI if any dependency uses a non-allowed license
- Tool: `license-checker` or `license-checker-rspack` (research during discuss)

### Jest config hygiene
- Add `testPathIgnorePatterns: ['.claude/worktrees']` to jest config
- Prevents jest from picking up test files in worktree copies

### UAT CI guard
- Add `process.env.CI` guard to UAT tests that require vault access or external services
- Add `test:uat` script to package.json that unsets CI for local runs
- UAT tests skip cleanly in CI instead of failing on missing vault

## Backlog Items Addressed

| Backlog ID | Item |
|------------|------|
| B-08 | No ESLint / SAST in CI pipeline |
| B-13 | UAT tests need isolation (partial — CI guard) |

## Key Files

- `eslint.config.js` — new
- `.github/workflows/codeql.yml` — new
- `.github/workflows/ci.yml` — add lint + license steps
- `package.json` — new scripts
- `jest.config.js` or `package.json` jest section — testPathIgnorePatterns
