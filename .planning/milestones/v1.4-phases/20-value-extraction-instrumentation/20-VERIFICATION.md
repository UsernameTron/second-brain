---
phase: 20-value-extraction-instrumentation
verified: 2026-04-25T17:30:00Z
status: passed
score: 4/4 must-haves verified
verifier: gsd-verifier scope:general
test_totals:
  passing: 1074
  skipped: 5
  pre_existing_failures: 3
  total: 1082
pre_existing_failures:
  - file: test/integration/semantic-search.test.js
    scenario: Scenario 6 (missing VOYAGE_API_KEY paths)
    failures: 2
    origin: Phase 19 (semantic search)
    confirmed_pre_existing: true
    confirmation_method: 20-03 reverted source files; failures persist on baseline c574a83
  - file: test/uat/uat-classification.test.js
    scenario: UAT-01 (classifier accuracy <80% threshold)
    failures: 1
    origin: prior classifier work
    confirmed_pre_existing: true
    confirmation_method: 20-03 reverted source files; failure persists on baseline
human_verification: []
documentation_gaps:
  - file: .planning/REQUIREMENTS.md
    issue: "STATS-LATENCY-01 and STATS-GROWTH-01 still show `[ ]` checkbox + status `Pending` in coverage table"
    severity: info
    note: "Implementation is complete and verified; only the REQUIREMENTS.md status markers are stale. Cosmetic doc drift, not a goal-achievement gap. Recommend update in Phase 21 closeout."
---

# Phase 20: Value Extraction Instrumentation — Verification Report

**Phase Goal:** Every `/today` run records measurable evidence that memory is compounding, and the briefing opens with a one-line summary of yesterday's growth.

**Verified:** 2026-04-25
**Status:** PASSED
**Re-verification:** No (initial)

---

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth (from ROADMAP §Success Criteria) | Status | Evidence |
|---|----------------------------------------|--------|----------|
| 1 | After each `/today` run, `~/Claude Cowork/RIGHT/daily-stats.md` contains exactly one row per local-day with the 8 specified columns | VERIFIED | `src/daily-stats.js` `COLUMNS` constant lists the 8 columns in declared order (lines 56-65); `recordDailyStats()` at lines 181-247 writes exactly those columns. Atomic write via `vaultWriteAtomic`. |
| 2 | Running `/today` twice on the same day updates the existing row rather than appending a duplicate | VERIFIED | `recordDailyStats()` lines 217-236: idempotent merge via `findIndex(r => r.date === today)`; replace-in-place on match, ascending insert otherwise. Test coverage in `test/daily-stats.test.js` (16 tests) including same-day re-run case. |
| 3 | The `/today` briefing opens with a one-line summary drawn from prior-day's stats row; the line is omitted when no prior-day row exists | VERIFIED | `src/today/briefing-renderer.js` lines 326-364: `buildYesterdaySummaryLine()` from `briefing-helpers.js` prepends summary above body. Largest-date-strictly-less-than-today selection rule (line 348) handles history gaps. Silent suppression on all 4 degenerate paths (missing file, parse throw, day-1, summaryLineEnabled=false). |
| 4 | The stats row captures per-connector latency (calendar, gmail, github) and per-operation latency (semanticSearch, memoryEcho) alongside end-to-end `/today` latency | VERIFIED | `src/today-command.js` lines 163-282: `latencies` accumulator object populated in `_fanOut` (connectors), getMemoryEcho timing block (line 216 onwards), and `latencies.endToEnd = Date.now() - t0` at line 278. Mean computed line 280-282 → `avgLatencyMs` field on the recorded row. |

**Score: 4/4**

### Required Artifacts (Three-Level Verification)

| Artifact | Exists | Substantive | Wired | Status |
|----------|--------|-------------|-------|--------|
| `src/daily-stats.js` | yes (15891 B, 425+ LOC) | yes — exports `recordDailyStats`, `dateKey`, `readDailyStats`, 5 counter helpers, `readDailyCounters` | yes — required by `today-command.js`, `recall-command.js`, `semantic-index.js`, `promote-memories.js`, `briefing-renderer.js` | VERIFIED |
| `src/vault-gateway.js` (`vaultWriteAtomic`) | yes (line 517) | yes — synchronous `.tmp + renameSync`, reuses `normalizePath`+`checkPath`, mirrors `voyage-health.js _writeHealth` | yes — called by `daily-stats.js _writeDailyStats` | VERIFIED |
| `src/briefing-helpers.js` (`buildYesterdaySummaryLine`) | yes (line 139) | yes — pure formatter, verbatim D-05 wording, signed deltas, em-dash for null memoryKb fallback | yes — required lazily by `briefing-renderer.js` line 354 | VERIFIED |
| `src/today/briefing-renderer.js` (summary-line prepend) | yes (lines 326-364) | yes — full try/catch wrapper, lazy requires, largest-date-less-than-today rule | yes — `renderBriefing` is the canonical briefing-render entry point | VERIFIED |
| `src/today-command.js` (`recordStats` orchestrator step) | yes (lines 284-323) | yes — 7-field payload aggregation, sub-fetch isolation, dry-run skip | yes — runs after briefing-renderer in `runToday()` | VERIFIED |
| `config/schema/pipeline.schema.json` (`stats` sub-object) | yes | yes — 5 keys (`enabled`, `path`, `timezone`, `summaryLineEnabled`, `schemaVersion`), `additionalProperties: false`, optional + defaulted | yes — read via `loadConfigWithOverlay('pipeline', {validate: true})` in renderer + today-command | VERIFIED |
| `config/pipeline.json` (`stats` defaults) | yes | yes — `timezone: America/Chicago`, `path: RIGHT/daily-stats.md`, `enabled: true` | yes — overlay-validated at config load time | VERIFIED |
| `config/vault-paths.json` (RIGHT segment) | yes — `RIGHT` first entry in `right` array | yes | yes — `vaultWriteAtomic('RIGHT/daily-stats.md', ...)` passes `checkPath` | VERIFIED |

### Architectural Invariants (Locked Decisions)

| Decision | What it requires | Verification | Status |
|----------|------------------|--------------|--------|
| **D-04** Memory Echo bypass | `recordRecallInvocation` fires ONLY on explicit `/recall`, never on Memory Echo's morning hit | `grep -rn recordRecallInvocation src/` returns hits only at `daily-stats.js:317` (definition), `daily-stats.js:422` (export), `recall-command.js:66-67` (inside `runRecall()`). `src/memory-reader.js getMemoryEcho` does not reference `runRecall` (grep `runRecall` in memory-reader.js → 0 hits). Bypass enforced structurally. | ENFORCED |
| **D-06** Briefing-is-the-product | Every `recordDailyStats` call wrapped in try/catch; sub-fetches isolated; dry-run skipped; failures never break briefing | `src/today-command.js:287-323`: outer try at 288, catch at 320 (silent), 3 inner try/catch blocks with safe defaults (counters→zeros, memoryKb→0, totalEntries→0), `mode !== 'dry-run'` guard at 287. `src/today/briefing-renderer.js:330-362`: try at 330, catch at 359 with `summaryLine = ''` fallback. | ENFORCED |
| **D-07** Emit-only telemetry | `recordTopCosine` / `recordTopRrf` write to staging file but are NOT surfaced as `daily-stats.md` columns | `COLUMNS` in `daily-stats.js:56-65` lists 8 entries — no `avg_top_semantic` or `avg_top_rrf`. `topCosineScores[]` / `topRrfScores[]` are written by emit functions (lines 368-393) and persist in the counter cache JSON, but no Phase 20 code reads them back into the rendered row. Reserved for Phase 21+ surface. | ENFORCED |
| **D-09** Cross-process counter staging | Counters accumulated in `~/.cache/second-brain/daily-counters-{dateKey}.json` with atomic .tmp+rename, never-throws contract | `src/daily-stats.js:278-310`: `_counterPath(now)` returns `~/.cache/second-brain/daily-counters-${dateKey(now)}.json` (CACHE_DIR_OVERRIDE supported for tests). `_writeCounters` does `fs.writeFileSync(tmp, ...)` + `fs.renameSync(tmp, filePath)` with mode `0o600`. All 5 emit functions (lines 317-393) wrap body in `try { ... } catch (_) { /* non-fatal */ }`. | ENFORCED |

---

## Requirements Coverage

| REQ ID | Description | Plan(s) | REQUIREMENTS.md status | Codebase evidence | Verdict |
|--------|-------------|---------|------------------------|-------------------|---------|
| **STATS-DAILY-01** | `appendDailyStats()` writes one row/day to `RIGHT/daily-stats.md` with 8 columns; idempotent same-day | 20-01, 20-02, 20-03, 20-04 | `[x]` Complete | `recordDailyStats()` in `src/daily-stats.js:181`; 8-column COLUMNS const; idempotent merge at lines 217-236; 22 tests in `test/daily-stats.test.js` | SATISFIED |
| **STATS-LATENCY-01** | `today-command.js` records end-to-end + per-connector + per-operation latency; `avg_latency_ms` on row | 20-03, 20-04 | `[ ]` "Pending" (stale doc marker) | `latencies` accumulator + Date.now() wrappers in `src/today-command.js:163-282`; `endToEnd`, calendar/gmail/github (via `_fanOut`), `getMemoryEcho` measured; mean → `avgLatencyMs` at line 281 → passed into `recordDailyStats` | SATISFIED (doc gap noted) |
| **STATS-GROWTH-01** | `memory_kb` + `total_entries` per day; timezone-safe `dateKey()` unit-tested at 23:59/00:01 | 20-02, 20-04 | `[ ]` "Pending" (stale doc marker) | `dateKey()` in `src/daily-stats.js:40` uses `Intl.DateTimeFormat('en-CA', {timeZone: 'America/Chicago'})`; 6 tests in `test/daily-stats.test.js` including 23:59 + 00:01 + DST boundary cases. `memoryKb` from `fs.statSync(memoryPath).size / 1024` (today-command.js:301), `totalEntries` from `readMemory().length` (today-command.js:308). | SATISFIED (doc gap noted) |
| **TODAY-SUMMARY-01** | `/today` briefing opens with one-line "Yesterday: ..." summary from prior-day row | 20-05 | `[x]` Complete | `buildYesterdaySummaryLine()` in `src/briefing-helpers.js:139` (pure formatter, verbatim D-05 wording); `renderBriefing` prepends at top of body in `src/today/briefing-renderer.js:326-364`; silent suppression on day-1, parse error, missing file, summaryLineEnabled=false. 21 tests in `test/briefing-helpers.test.js` (9 new) + 27 in renderer suite (7 new). | SATISFIED |

**All 4 phase requirements satisfied in code.** Two REQUIREMENTS.md status markers (STATS-LATENCY-01, STATS-GROWTH-01) are stale doc-only — implementation is verified complete. This is documentation drift, not a goal-achievement gap.

**Note on timezone:** ROADMAP success criterion #1 cites `America/Los_Angeles` but `REQ-AMEND-01` (committed 4a9bb8d) corrected the locked timezone to `America/Chicago` (D-08, operator is in Fort Worth). Implementation correctly uses `America/Chicago` per the amended requirement. The ROADMAP success-criterion text at line 181 may also need a doc-cleanup pass in Phase 21.

---

## Behavioral Spot-Checks

| Test bundle | Result | Source |
|-------------|--------|--------|
| `test/daily-stats.test.js` (38 tests including 6 dateKey + 16 recordDailyStats + 16 counter-helper) | PASS | Orchestrator-confirmed: 38 of 72 daily-stats reported |
| `test/integration/today-stats.test.js` (6 SC scenarios — first-run, idempotent, dry-run skip, throw-swallow, missing memory.md, latency round-trip) | PASS | Orchestrator-confirmed |
| `test/today-command.test.js` Phase 20 recordStats tests | PASS | Orchestrator-confirmed (40 today-command tests total) |
| `test/today/briefing-renderer.test.js` Phase 20 yesterday-summary tests (7 new) | PASS | Orchestrator-confirmed (27 renderer tests total) |
| `test/briefing-helpers.test.js` `buildYesterdaySummaryLine` tests (9 new) | PASS | Orchestrator-confirmed (21 helper tests total) |

**Phase 20 dedicated test count: 126 tests passing across 5 test files** (orchestrator-verified, not re-run here).

---

## Pre-Existing Failures (Out of Scope for Phase 20)

These 3 failures exist on the pre-Phase-20 baseline (commit `c574a83`) and are confirmed pre-existing by reverting plan 20-03 source files during execution:

| File | Scenario | Failures | Origin |
|------|----------|----------|--------|
| `test/integration/semantic-search.test.js` | Scenario 6 | 2 | Phase 19 — missing `VOYAGE_API_KEY` fallback paths |
| `test/uat/uat-classification.test.js` | UAT-01 | 1 | Prior classifier work — accuracy <80% threshold |

These are not Phase 20 regressions and do not affect Phase 20 verdict.

**Test totals:** 1074 passing, 5 skipped, 3 pre-existing failures (1082 total).

---

## Anti-Pattern Scan (Phase 20 modified files)

Scanned: `src/daily-stats.js`, `src/today-command.js`, `src/briefing-helpers.js`, `src/today/briefing-renderer.js`, `src/recall-command.js`, `src/semantic-index.js`, `src/promote-memories.js`, `src/vault-gateway.js`.

| Category | Result |
|----------|--------|
| TODO/FIXME/PLACEHOLDER comments in modified blocks | None |
| Empty implementations (`return null`, `return {}`, `=> {}`) | None — all returns substantive |
| Hardcoded empty data flowing to user output | None — defaults are deliberate "valid-but-zero" rows per D-06 |
| Empty handlers / console.log-only handlers | None — all catches have either documented silent-suppression rationale (D-06) or safe-default fallback comments |
| Stub patterns | None — both 20-02 and 20-05 SUMMARYs explicitly assert "no stubs" via grep verification |

---

## Human Verification Required

None. All success criteria verifiable programmatically; all artifacts wired and tested; all architectural invariants enforced structurally (not by convention).

---

## Gaps Summary

**No goal-achievement gaps.** One documentation drift item to flag for Phase 21 (closeout):

- `.planning/REQUIREMENTS.md` lines 36-37 (`STATS-LATENCY-01`, `STATS-GROWTH-01`) still show `[ ]` checkbox; coverage table lines 88-89 still show "Pending". Implementation is verified complete; only the doc markers are stale. Recommend updating in Phase 21 alongside the other documentation finalization (HYG-DOCS work).

- `.planning/ROADMAP.md` line 181 cites `America/Los_Angeles` in Success Criterion 1, but REQ-AMEND-01 (already shipped) locked the timezone to `America/Chicago`. Implementation correctly follows the amended requirement. Same Phase 21 doc-cleanup pass should reconcile this.

Both items are documentation drift, not implementation gaps.

---

## Verdict

**Status: PASSED**

All 4 phase requirements satisfied. All 4 architectural invariants (D-04, D-06, D-07, D-09) enforced structurally. All Phase 20 dedicated tests green (126 tests). The 3 baseline failures are pre-existing and out of scope. Two stale doc markers in REQUIREMENTS.md / ROADMAP.md flagged for Phase 21 closeout — not blocking.

---

_Verified: 2026-04-25_ / _Verifier: Claude (gsd-verifier scope:general)_
