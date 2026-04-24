# Phase 14 — CI Hardening

**Phase:** 14
**Milestone:** v1.3 Review Remediation
**Status:** PLANNED
**Workstream:** ci-hardening
**Branch:** feat/phase-14-ci-hardening
**Dependencies:** Phase 12 (SHIPPED — security-scan-gate fix in place)

## Tasks

### T14.1 — ESLint

**Goal:** Add ESLint 9+ with flat config, lint all source and test files, add CI gate.

**Implementation:**
1. Install devDependencies: `eslint`, `@eslint/js`, `eslint-plugin-jest`, `eslint-plugin-n`
2. Create `eslint.config.js` (flat config, ESLint 9+):
   - Extend `@eslint/js/recommended`
   - Rules: `no-unused-vars: "error"`, `no-console: "warn"` (off in test files), `prefer-const: "error"`, `eqeqeq: "error"`
   - Jest plugin config for `test/` directory
   - Node plugin config for `src/` directory
3. Add `lint` script to `package.json`: `eslint src/ test/`
4. Add CI step in `.github/workflows/ci.yml` after install: `npm run lint`
5. Fix every existing violation — prefer `eslint --fix` first, then manual fixes for what remains
6. Lint cleanup in a separate commit for clean diff

**Tests:** Lint passes cleanly on CI. No functional tests needed — lint is the test.

**Files:** `eslint.config.js` (new), `package.json`, `.github/workflows/ci.yml`, various `src/` and `test/` files (autofix)
**Commits:**
- `feat(ci): T14.1 — add ESLint 9 with flat config and CI gate`
- `style(lint): apply eslint autofix` (cleanup commit)

---

### T14.4 — Jest worktree exclusion

**Goal:** Prevent Jest from discovering test files inside `.claude/worktrees/` directories.

**Implementation:**
1. Locate Jest config (check `package.json` `jest` block or `jest.config.js`)
2. Add `testPathIgnorePatterns: ["/node_modules/", ".claude/worktrees"]`
3. Verify: Jest discovers the expected 28 suites (not 28+N from worktrees)

**Tests:** Run `npx jest --listTests | wc -l` before and after to confirm no change in test count.

**Files:** `package.json` (jest block) or `jest.config.js`
**Commit:** `feat(ci): T14.4 — exclude worktrees from jest discovery`

---

### T14.5 — UAT CI skip

**Goal:** UAT tests skip cleanly in CI instead of failing. Resolves `UAT-BASELINE.md`.

**Implementation:**
1. Edit `test/uat/uat-classification.test.js`
2. Replace `describe` with conditional: `const skipInCI = process.env.CI ? describe.skip : describe;`
3. Wrap the outer describe block(s) with `skipInCI`
4. Add comment: `// UAT tests require live LLM endpoint — skip in CI, run locally via npm run test:uat`
5. Add `test:uat` script to `package.json`: `CI= npx jest --forceExit test/uat/`
6. Update `.planning/milestones/v1.3/UAT-BASELINE.md`: mark UAT-01 as RESOLVED with commit SHA, status: skipped in CI, runnable locally via `npm run test:uat`

**Tests:**
- `CI=true npx jest --forceExit test/uat/` — all tests skipped, 0 failures
- `CI= npx jest --forceExit test/uat/` — tests run (will fail without LLM, but they run)
- Full suite: 640/640 pass (UAT skipped in CI = no failure)

**Files:** `test/uat/uat-classification.test.js`, `package.json`, `.planning/milestones/v1.3/UAT-BASELINE.md`
**Commit:** `feat(ci): T14.5 — UAT CI skip guard + test:uat script`

---

### T14.2 — SAST via CodeQL

**Goal:** Add CodeQL analysis workflow for JavaScript security scanning.

**Implementation:**
1. Create `.github/workflows/codeql.yml`:
   - Triggers: push to `master`, pull_request to `master`, weekly cron (`0 6 * * 1`)
   - Uses: `github/codeql-action/init@v3` with `languages: javascript`
   - Uses: `github/codeql-action/analyze@v3`
   - Default query suite (no custom config)
2. No package.json changes — CodeQL runs via GitHub Actions only

**Tests:** Workflow syntax valid (check via `gh workflow view` after push). CodeQL results visible in GitHub Security tab.

**Files:** `.github/workflows/codeql.yml` (new)
**Commit:** `feat(ci): T14.2 — CodeQL SAST workflow`

---

### T14.3 — License compliance

**Goal:** Add license checker to CI pipeline with permissive-only allowlist.

**Implementation:**
1. Install devDependency: `license-checker`
2. Add `license-check` script to `package.json`: `license-checker --production --onlyAllow 'MIT;ISC;Apache-2.0;BSD-2-Clause;BSD-3-Clause;CC0-1.0'`
3. Add CI step in `.github/workflows/ci.yml`: `npm run license-check`
4. Run locally first to verify all production dependencies pass

**Tests:** `npm run license-check` exits 0. Any non-compliant dependency surfaces as a CI failure.

**Files:** `package.json`, `.github/workflows/ci.yml`
**Commit:** `feat(ci): T14.3 — license compliance gate`

---

## Execution Plan

**Order:** T14.1 → T14.4 → T14.5 → T14.2 → T14.3

Rationale: Lint first catches code issues the rest might introduce. Jest config and UAT skip are quick wins. CodeQL last because it's most likely to surface unexpected findings that need triage.

**Subagent plan:** One subagent per task, sequential. test-verifier after each commit. T14.1 will produce a noisy autofix commit — expected.

**Commit strategy:** 5+ commits on `feat/phase-14-ci-hardening`, Conventional Commit messages prefixed `feat(ci): T14.X — <description>` (lint cleanup: `style(lint): apply eslint autofix`).

## Verification

- `npm run lint` passes cleanly
- `npm run license-check` passes cleanly
- `.github/workflows/codeql.yml` exists and is valid YAML
- Jest discovers exactly the expected test suites (no worktree contamination)
- `CI=true npx jest --forceExit` — 640/640 pass, 0 fail (UAT skipped, not failed)
- Full test suite passes
- UAT-BASELINE.md updated to RESOLVED

## Backlog Coverage

| Backlog ID | Addressed By |
|------------|-------------|
| B-08 | T14.1 (ESLint), T14.2 (CodeQL) |
| B-13 | T14.5 (UAT CI guard — partial, full isolation in Phase 16) |
| (jest config) | T14.4 |
| (license) | T14.3 |
| (UAT-01 baseline) | T14.5 |
