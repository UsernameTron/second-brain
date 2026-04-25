---
phase: 20-value-extraction-instrumentation
plan: 02
subsystem: instrumentation
tags: [daily-stats, vault-gateway, atomic-write, pattern-11, pattern-7, gray-matter]

# Dependency graph
requires:
  - phase: 20-01
    provides: "stats sub-object in pipeline.schema.json + stats defaults in pipeline.json"
  - phase: 19-semantic-memory-search
    provides: "voyage-health.js atomic .tmp+rename idiom (Pattern 7 reference)"
provides:
  - "src/daily-stats.js: recordDailyStats(), dateKey(), readDailyStats() — storage substrate for 8-column daily rows"
  - "src/vault-gateway.js: vaultWriteAtomic() — synchronous atomic RIGHT-side write enforcing Pattern 11"
  - "RIGHT segment added to config/vault-paths.json allowlist for daily-stats.md writes"
affects:
  - 20-03-emit-points
  - 20-04-today-command-integration
  - 20-05-summary-line-render

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pattern 11 enforced in vaultWriteAtomic: LEFT/RIGHT boundary in code, not config — misconfigured stats.path throws, not silently writes"
    - "Pattern 7 atomic write: .tmp + fs.renameSync in vault-gateway, never in daily-stats directly"
    - "Pattern 12 lazy require: vault-gateway and pipeline-infra required inside recordDailyStats(), not at module top"
    - "TDD: RED (failing tests) committed before GREEN (implementation) for both Task 0 and Tasks 1+2"
    - "Idempotent same-day rewrite: read → replace row at today's dateKey → atomic write (last-run-wins)"

key-files:
  created:
    - src/daily-stats.js
    - test/daily-stats.test.js
  modified:
    - src/vault-gateway.js
    - test/vault-gateway.test.js
    - config/vault-paths.json

key-decisions:
  - "vaultWriteAtomic is synchronous (matches voyage-health.js _writeHealth) — daily-stats writes are end-of-session snapshots, not hot-path async"
  - "RIGHT added to config/vault-paths.json as the vault segment for daily-stats.md — matches pipeline.json stats.path default"
  - "Spy-on-exports approach for helper-reuse test replaced with structural source-scan (CommonJS closure prevents export spy interception)"
  - "Branch coverage at 89.85% — remaining uncovered branches are gray-matter defensive || fallbacks that require library mocking; all statement/function/line coverage at 100%"

# Metrics
duration: 9min
completed: 2026-04-25
---

# Phase 20 Plan 02: Daily-Stats Core Module Summary

**`src/daily-stats.js` exports `recordDailyStats`, `dateKey`, `readDailyStats`; `src/vault-gateway.js` gains synchronous `vaultWriteAtomic`; Pattern 11 boundary enforced in code with 22 new tests passing at 100% statements/lines/functions, 89.85% branch**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-04-25T15:20:57Z
- **Completed:** 2026-04-25T15:32:38Z
- **Tasks:** 3 (Task 0: vaultWriteAtomic, Task 1: dateKey, Task 2: recordDailyStats)
- **Files modified:** 5

## Accomplishments

### Task 0: vaultWriteAtomic (vault-gateway.js)
- Added synchronous `vaultWriteAtomic(relativePath, content)` to `src/vault-gateway.js`
- Reuses existing `normalizePath()` + `checkPath()` guards — no duplicated path-security logic
- Atomic `.tmp` + `fs.renameSync()` idiom mirrors `voyage-health.js` `_writeHealth` exactly
- LEFT/RIGHT boundary enforced in code (Pattern 11): LEFT-side or unknown-segment paths throw `VaultWriteError(PATH_BLOCKED)`
- Added `RIGHT` to `config/vault-paths.json` allowlist to match `pipeline.json` stats.path default
- 8 new tests in `describe('vaultWriteAtomic()')` — all pass; vaultWriteAtomic body lines 100% covered

### Task 1: dateKey (daily-stats.js)
- `dateKey(now?, tz?)` uses native `Intl.DateTimeFormat('en-CA', {timeZone})` — zero new dependencies
- en-CA locale produces YYYY-MM-DD natively
- Optional second argument `tz` defaults to `'America/Chicago'` — pure and unit-testable without config mocking
- 6 tests including mandatory D-08 boundary cases: 23:59 Central, 00:01 Central, DST spring-forward

### Task 2: recordDailyStats + readDailyStats (daily-stats.js)
- `recordDailyStats(stats, opts)` writes 8-column rows via `vaultWriteAtomic` — never calls `fs.writeFileSync` directly
- gray-matter serializes YAML frontmatter with schema_version, columns, last_updated, timezone
- Idempotent: same-day re-call replaces the row in-place (last-run-wins); different day appends ascending
- Null `avgLatencyMs` / `avgConfidence` render as `—` (em-dash); `memoryKb` rounded to 1 decimal
- `readDailyStats(absPath)` returns `{frontmatter: null, rows: []}` on ENOENT; throws on other fs errors
- `opts.configOverride` and `opts.now` make the function fully testable without touching real vault or config
- 16 tests covering all 10 plan-specified cases plus 6 additional branch-coverage cases

## Task Commits

| Task | Description | Commit |
|------|-------------|--------|
| 0 | vaultWriteAtomic + 8 new vault-gateway tests + RIGHT allowlist | 11ebd3f |
| 1+2 | daily-stats.js module + 22 tests (dateKey + recordDailyStats) | f6d06d3 |

## Files Created/Modified

- `src/vault-gateway.js` — Added `vaultWriteAtomic()` function + export (lines 497-555); exported alongside `vaultWrite`/`vaultRead`
- `test/vault-gateway.test.js` — Added `describe('vaultWriteAtomic()')` with 8 tests (describe block at lines 376-519)
- `config/vault-paths.json` — Added `"RIGHT"` as first entry in `right` array
- `src/daily-stats.js` — New module: `dateKey`, `readDailyStats`, `renderTable`, `_writeDailyStats`, `recordDailyStats`; 250 lines
- `test/daily-stats.test.js` — New test file: 22 tests across `describe('dateKey()')` and `describe('recordDailyStats()')`

## Coverage

| File | Statements | Branch | Functions | Lines |
|------|-----------|--------|-----------|-------|
| src/daily-stats.js | 100% | 89.85% | 100% | 100% |
| src/vault-gateway.js (new fn) | 100% | 100% | 100% | 100% |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added RIGHT to vault-paths.json allowlist**
- **Found during:** Task 0 implementation
- **Issue:** `config/vault-paths.json` had no `RIGHT` segment; `vaultWriteAtomic('RIGHT/daily-stats.md', ...)` would always throw `PATH_BLOCKED`
- **Fix:** Added `"RIGHT"` as first entry in `right` array — matches `pipeline.json` stats.path default `RIGHT/daily-stats.md`
- **Files modified:** `config/vault-paths.json`
- **Commit:** 11ebd3f

**2. [Rule 1 - Bug] Replaced jest.spyOn helper-reuse test with structural scan**
- **Found during:** Task 0 GREEN phase
- **Issue:** `jest.spyOn(module.exports, 'normalizePath')` does not intercept calls made via the module's internal closure binding in CommonJS — spy counts stayed at 0
- **Fix:** Replaced runtime spy assertion with source-code structural scan: regex confirms `vaultWriteAtomic` body calls `normalizePath(` and `checkPath(` and contains no duplicated `config.right.includes` or `..` check
- **Files modified:** `test/vault-gateway.test.js`
- **Commit:** 11ebd3f

## Known Stubs

None — all exports are fully implemented. No TODO, FIXME, or stub patterns present.

## Self-Check: PASSED

- `src/daily-stats.js` exists at expected path
- `src/vault-gateway.js` exports `vaultWriteAtomic` (grep confirmed)
- `config/vault-paths.json` contains `RIGHT` segment (grep confirmed)
- Commit 11ebd3f exists (Task 0)
- Commit f6d06d3 exists (Tasks 1+2)
- 22 daily-stats tests pass; 50 vault-gateway tests pass
- Coverage thresholds met: daily-stats 100%/89.85%/100%/100%; vaultWriteAtomic 100% all metrics
- No direct `fs.writeFileSync` or `fs.renameSync` calls in `src/daily-stats.js`
- Pattern 11 boundary test (LEFT/spoof.md THROWS) present and passing
- D-08 boundary tests (23:59 + 00:01 + DST) present and passing
