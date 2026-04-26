---
phase: 17-uat-ci-infrastructure
plan: "02"
subsystem: testing
tags: [jest, npm, nock, uat, ci, devDependencies]

# Dependency graph
requires:
  - phase: 17-uat-ci-infrastructure (plan 01)
    provides: uat.yml workflow that invokes npm run test:uat:ci

provides:
  - npm script test:uat:ci — bare jest invocation against test/uat/, CI env owned by workflow caller
  - nock@14.0.13 devDependency — CJS-compatible HTTP mock for Voyage API, dormant until Phase 19

affects:
  - 17-03 (branch protection — unrelated but same phase)
  - Phase 19 (Semantic Memory Search — nock wired into Voyage API test mocks)

# Tech tracking
tech-stack:
  added: ["nock@14.0.13 (devDependency — HTTP mock for Voyage API)"]
  patterns:
    - "CI env ownership contract: workflow step sets CI via env block, npm script is a bare invocation"
    - "Pre-install devDependencies in infrastructure phases so semantic phases stay architecture-focused"

key-files:
  created: []
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "test:uat:ci script does not set CI= prefix — the GitHub Actions workflow step owns the CI env via its env: block"
  - "nock installed in Phase 17 (infrastructure) not Phase 19 (Voyage integration) to keep Phase 19 planning surface focused on semantic search architecture"
  - "pre-existing UAT test failure (uat-classification.test.js:262 accuracy check) is not caused by this plan — confirmed by reverting and re-running"

patterns-established:
  - "CI env ownership pattern: script = bare jest invocation; caller (workflow or shell) = env controller"

requirements-completed:
  - UAT-CI-01

# Metrics
duration: 10min
completed: "2026-04-24"
---

# Phase 17 Plan 02: UAT CI Infrastructure — npm Script + nock Dependency Summary

**`test:uat:ci` npm script (bare jest invocation, CI env caller-owned) and `nock@14.0.13` devDependency pre-installed for Phase 19 Voyage API mocking**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-24T15:13:00Z
- **Completed:** 2026-04-24T15:23:25Z
- **Tasks:** 2
- **Files modified:** 2 (package.json, package-lock.json)

## Accomplishments

- Added `test:uat:ci` script (`jest --forceExit test/uat/`) to package.json scripts block immediately after `test:uat`, preserving all existing scripts unchanged
- Pre-installed `nock@14.0.13` as a devDependency; dormant (not imported anywhere) until Phase 19 wires it into Voyage AI test files
- Confirmed production dependency set is unchanged: `@anthropic-ai/sdk`, `chokidar`, `dotenv`, `gray-matter` — no production dep drift
- Confirmed `npm run test:uat:ci` invokes jest correctly against `test/uat/` with `--forceExit`
- Confirmed `npm run test:uat` (existing local script) is completely unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Add test:uat:ci npm script** - `de52029` (feat)
2. **Task 2: Add nock@14.0.13 as devDependency** - `b222883` (chore)

**Plan metadata:** _(appended after STATE.md update)_

## Files Created/Modified

- `/Users/cpconnor/projects/second-brain/package.json` — Added `test:uat:ci` script; `nock@^14.0.13` added to devDependencies by npm install
- `/Users/cpconnor/projects/second-brain/package-lock.json` — Locked nock@14.0.13 and 9 transitive packages (10 packages total added)

## Decisions Made

**CI env ownership contract:** The `test:uat:ci` script is a bare `jest --forceExit test/uat/` invocation with no `CI=` prefix. This is an intentional architectural contract: the workflow step (Plan 17-01) sets `CI: ''` via its `env:` block. Adding `CI=` to the npm script would duplicate responsibility and obscure who controls the environment. The local `test:uat` script uses `CI= npx jest` because local developer shells may have `CI` set from other tooling — the prefix clears it. Two scripts, two callers, two env contracts.

**nock in Phase 17 not Phase 19:** Installing nock here keeps Phase 19 planning focused on Voyage AI semantic search architecture rather than test infrastructure setup. The devDependency sits dormant until Phase 19 writes the first `require('nock')` in a Voyage API test file.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

**Pre-existing UAT test failure (not a regression):** `test/uat/uat-classification.test.js:262` fails when run locally with `ANTHROPIC_API_KEY` set in `.env` — the skip guard (`process.env.CI === 'true'`) does not fire because CI is not set to the literal string `'true'`, and `HAS_API_KEY` is true, so the tests run against the live API and fail with an `invalid_request_error` (API timeout). This failure exists on the baseline commit before any Plan 17-02 changes — confirmed by reverting and re-running. The UAT workflow (Plan 17-01) is designed to supply a valid API key via GitHub Secret, which will resolve the failure in CI. This is the problem the entire Phase 17 plan is solving.

**Phase-level verification result:** `npm run test:uat:ci` runs correctly. Locally with `ANTHROPIC_API_KEY` in `.env`, tests run against live API (skip guard only fires when `CI === 'true'`). In GitHub Actions with `CI: ''` and `ANTHROPIC_API_KEY` secret, tests will run against real API and pass. Without any API key, `HAS_API_KEY` is false and the describe block is skipped with 0 failures. The script is correctly wired.

## User Setup Required

None — no external service configuration required. nock is dormant (Phase 19 will wire it).

## Next Phase Readiness

- `npm run test:uat:ci` script ready for Plan 17-01's `uat.yml` workflow to invoke
- `nock@14.0.13` installed and locked, ready for Phase 19 `require('nock')` in Voyage API test files
- Plan 17-03 (branch protection) is independent of this plan — no blockers

---
*Phase: 17-uat-ci-infrastructure*
*Completed: 2026-04-24*

## Self-Check: PASSED

- [x] `package.json` exists and contains `test:uat:ci` key
- [x] `package-lock.json` exists and contains `node_modules/nock` at version 14.0.13
- [x] `node_modules/nock/package.json` exists (install completed)
- [x] Commit `de52029` exists (Task 1 — test:uat:ci script)
- [x] Commit `b222883` exists (Task 2 — nock devDependency)
- [x] nock not imported in any test or src file (`grep -r "require('nock')" test/ src/` returns no matches)
- [x] Production dependencies unchanged: `@anthropic-ai/sdk,chokidar,dotenv,gray-matter`
