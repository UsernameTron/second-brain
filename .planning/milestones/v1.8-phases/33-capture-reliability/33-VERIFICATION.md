---
phase: 33-capture-reliability
verified: 2026-07-21T23:55:00Z
status: passed
score: 15/15 must-have truths verified
requirements:
  CAP-LAUNCHD-01: satisfied
  CAP-CLASSIFIER-01: satisfied
  CAP-EVIDENCE-01: satisfied
human_verification:
  - test: "Confirm tonight's scheduled 23:45 launchd fire (not the same-day kickstart)"
    expected: "launchctl print ... shows last exit code = 0; state/daily-sweep-last-run.json ts is ~23:45 with the schema-patched code; /today Compounding shows 'sweep ran 23:45, staged N'"
    why_human: "Overnight scheduled fire cannot be observed at verification time; the same-day kickstart already satisfied the 'observe one real fire FIRST' gate. Known deferred item per 33-CONTEXT, not a gap."
---

# Phase 33: Capture Reliability Verification Report

**Phase Goal:** Fix + version the com.secondbrain.daily-sweep launchd plist and observe one real fire FIRST; persist state/daily-sweep-last-run.json; /today Compounding line "sweep ran/staged N | STALE | NEVER RAN"; src/utils/classifier-health.js (voyage-health clone) gating local-27B -> classifyAnthropic fallback, extended to HTTP/parse errors, with per-night Haiku call cap.
**Verified:** 2026-07-21T23:55:00Z (HEAD bc1774a, branch feat/phase-33-capture-reliability)
**Status:** passed
**Re-verification:** No

## Goal Achievement

### Observable Truths (15/15 verified)

| # | Truth (plan) | Status | Evidence |
|---|--------------|--------|----------|
| 1 | kickstart exits 0 (not 78) + non-empty log (33-01) | PASS | `last exit code = 0`; log 22802 bytes, ends "[daily-sweep] Sweep complete for 2026-07-21" |
| 2 | active registration runs node@22 not bare node (33-01) | PASS | `launchctl print`: program = /opt/homebrew/opt/node@22/bin/node; PATH has node@22 |
| 3 | config plist is versioned source of truth (33-01) | PASS | config/com.secondbrain.daily-sweep.plist exists, plutil -lint OK |
| 4 | classifier-health records http/parse/timeout, degrades after 3 (33-02) | PASS | DEGRADED_FAILURE_THRESHOLD=3; `consecutive_failures >= THRESHOLD` sets degraded_until; 8/8 unit tests green |
| 5 | recordSuccess resets counter + closes window (33-02) | PASS | recordSuccess sets consecutive_failures=0, degraded_until=null |
| 6 | per-night Haiku counter, resets on date rollover (33-02) | PASS | _localDateKey; `haiku_date !== key` resets count to 0; rollover test green |
| 7 | config carries haikuNightlyCap=50, schema-validated (33-02) | PASS | pipeline.json haikuNightlyCap:50; schema integer 1-1000, not required; loadPipelineConfig validates, cap resolves 50 |
| 8 | local failure records + falls back to Haiku (33-03) | PASS | classifyLocalWithHealth: failure -> recordFailure(code) -> haikuFallback(); http/shape/parse/timeout all covered |
| 9 | 3 consecutive failures -> degraded routes straight to Haiku, no local re-attempt (33-03) | PASS | `if (isDegraded()) return haikuFallback()` before classifyLocal; test asserts fetch not re-called |
| 10 | cap reached -> skip result (never throws) + logs skip (33-03) | PASS | returns {success:false,skipped:true,failureMode:'haiku-cap'}; logDecision SKIPPED; test asserts no throw |
| 11 | anthropic path unchanged (no gating/cap) (33-03) | PASS | `useLocal ? classifyLocalWithHealth : classifyAnthropic`; classifyAnthropic verbatim; provider:anthropic test green |
| 12 | non-dry-run sweep writes last-run json atomically w/ ts/staged/durationMs/degraded (33-04) | PASS | daily-sweep.js:290-306 tmp+renameSync, `!dryRun` guard; state file has all 4 keys |
| 13 | dry-run writes nothing (33-04) | PASS | test 'dry-run writes nothing': existsSync toBe(false) |
| 14 | /today shows "sweep ran HH:MM, staged N" when <26h (33-04) | PASS | computeSweepLine runtime returned "sweep ran 18:44, staged 2" |
| 15 | STALE >26h / NEVER RAN missing-corrupt, never throws (33-04) | PASS | STALE_MS=26h constant; fail-open returns 'sweep NEVER RAN' on missing/no-ts/NaN |

### Required Artifacts

| Artifact | Exists | Substantive | Wired | Data-Flow | Status |
|----------|--------|-------------|-------|-----------|--------|
| config/com.secondbrain.daily-sweep.plist | Y | Y (node@22, no LLM_PROVIDER, 2 logs) | Y (installed + bootstrapped) | n/a (config) | VERIFIED |
| src/utils/classifier-health.js | Y | Y (6 exports, atomic, date-keyed, fail-open) | Y (required by pipeline-infra + daily-sweep) | FLOWING (~/.cache state) | VERIFIED |
| config/pipeline.json + schema | Y | Y (cap 50, integer 1-1000) | Y (loadPipelineConfig reads) | FLOWING | VERIFIED |
| src/pipeline-infra.js (classifyLocalWithHealth) | Y | Y (full wrapper logic) | Y (returned from createLlmClient) | FLOWING | VERIFIED |
| scripts/daily-sweep.js (last-run write) | Y | Y (atomic, fail-open, !dryRun) | Y (writes state/) | FLOWING (real state file) | VERIFIED |
| src/today/sweep-status.js | Y | Y (3 states, STALE constant, fail-open) | Y (today-command requires it) | FLOWING (reads state) | VERIFIED |
| src/today/briefing-renderer.js (Compounding) | Y | Y (sweep-or-trend render) | Y (destructures sweep) | FLOWING | VERIFIED |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| ~/Library/LaunchAgents plist | scripts/daily-sweep.js | ProgramArguments node@22 + PATH | WIRED (live registration confirmed) |
| src/pipeline-infra.js | src/utils/classifier-health.js | recordFailure/recordSuccess/isDegraded/recordHaikuCall/isHaikuCapReached | WIRED (all 5 called) |
| pipeline-infra classifyLocal failure | classifyAnthropic | capped haikuFallback (single chokepoint) | WIRED (only call site at line 357) |
| scripts/daily-sweep.js | src/utils/classifier-health.js | isDegraded() -> degraded flag | WIRED (line 297) |
| src/today-command.js | src/today/sweep-status.js | computeSweepLine() -> renderBriefing sweep: | WIRED (lines 283-284, 312) |
| src/today/briefing-renderer.js | ## Compounding section | renders on compoundingBody OR sweep | WIRED (line 335) |

### Behavioral Spot-Checks

| Check | Result |
|-------|--------|
| `launchctl print` live job exit code | PASS (= 0) |
| `loadPipelineConfig()` cap=50, schema valid | PASS |
| `computeSweepLine()` returns valid state, no throw | PASS ("sweep ran 18:44, staged 2") |
| classifier-health 6 exports present | PASS |
| Full suite `npm test` | PASS (1465 passed / 29 skipped / 0 failures) |
| `npm run lint` | PASS (0 errors, 9 pre-existing jest/expect-expect warnings) |

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| CAP-LAUNCHD-01 | SATISFIED | plist versioned + rebootstrapped; real kickstart fire exit 0, log non-empty |
| CAP-CLASSIFIER-01 | SATISFIED | classifier-health module + config/schema (33-02) + createLlmClient wiring (33-03), inversion tested |
| CAP-EVIDENCE-01 | SATISFIED | atomic last-run write + computeSweepLine 3 states + always-on Compounding render |

### Anti-Patterns Found

None. Grep for TODO/FIXME/PLACEHOLDER/stub across all four phase-33 source files returned NONE_FOUND. The `console.error` calls in scripts/daily-sweep.js are intentional (scripts/ logs via console.error; the ESLint no-console gate is scoped to src/ and passes 0 errors).

### Locked-Decision Fidelity

| Decision | Status |
|----------|--------|
| No LLM_PROVIDER in daily-sweep plist (local-first) | HONORED (grep returns nothing) |
| STALE threshold >26h, constant not config | HONORED (STALE_MS = 26*60*60*1000) |
| Haiku cap default 50, config-keyed, sibling of llm | HONORED (classifier.haikuNightlyCap:50, read via pipelineConfig_.classifier) |
| Parse/HTTP fallback inversion intentional, failure kept loud | HONORED (7 named tests assert "now falls back"/"logged loudly"; logDecision + recordFailure on every failure path) — NOT an accidental regression |
| No log rotation (YAGNI) | HONORED (single log path retained) |

### Human Verification Required

1. **Tonight's scheduled 23:45 launchd fire.** Confirm tomorrow via `launchctl print gui/$UID/com.secondbrain.daily-sweep | grep "last exit code"` (= 0), `cat state/daily-sweep-last-run.json` (ts ~23:45, schema-patched code so no config-error), and a `/today` showing "sweep ran 23:45, staged N". This is the confirming observation deferred per 33-CONTEXT — NOT a gap. The same-day kickstart already satisfied the "observe one real fire FIRST" gate.

   Note: the 18:07 kickstart log shows a per-item `config-error` ("/classifier: must NOT have additional properties") and 3 FALLBACK events. That was the transient window before the schema patch landed (documented in 33-02 SUMMARY). `loadPipelineConfig()` validates at HEAD now, so tonight's fire will not reproduce it. The FALLBACK events are the exact wedge pathology 33-02/03 eliminate going forward.

### Gaps Summary

None. All 15 must-have truths verified; all artifacts pass all four levels; all six key links wired; full suite and lint green.

## Architecture Score

| Dimension | Weight | Score | Status |
|-----------|--------|-------|--------|
| Security | 35% | 82 | PASS |
| Performance | 25% | 88 | PASS |
| Correctness | 25% | 90 | PASS |
| Maintainability | 15% | 90 | PASS |
| **Overall** | **100%** | **86** | **PASS** |

### Criteria Detail

- **Prompt injection resistance (8):** N/A to this phase's surface; classify inputs pass through unchanged, no new instruction boundary introduced.
- **Permission boundaries (8):** plist runs as user gui domain, least-privilege PATH; no LLM_PROVIDER pin (local-first honored).
- **Secret handling (9):** no credentials in plist or config; daily-sweep loads .env at require.main only; state file carries no secrets.
- **Input validation (8):** config gated by AJV schema (integer 1-1000); fail-open reads validate ts/NaN before use.
- **Resource bounds (9):** per-night Haiku cap (50) bounds unattended API spend; degrade-after-3 skips the 60s local timeout; STALE_MS bounds staleness window.
- **Lazy loading (9):** classifier-health lazily required only on the useLocal path; sweep-status required per-call inside a try.
- **Concurrency design (7):** atomic tmp+renameSync avoids torn state files; single write at sweep end (no contention path here).
- **Error handling (10):** fail-open everywhere (reads never throw, evidence write swallowed to stderr, computeSweepLine never throws); classify contractually non-throwing at the cap.
- **Edge case coverage (9):** corrupt/missing/no-ts/NaN state -> NEVER RAN; date rollover resets cap; dry-run no-write; 26h boundary tested.
- **Type safety (8):** config schema-validated; structured {success,failureMode} contract consistent across classify paths.
- **Test coverage (9):** 8 classifier-health tests, inversion suite (http/parse/shape/timeout/cap/degrade), sweep-status 7 line-states, last-run write suite; full suite 1465 green.
- **Naming clarity (9):** classifyLocalWithHealth, haikuFallback, computeSweepLine, STALE_MS — intent-revealing.
- **Single responsibility (9):** classifier-health = pure state; sweep-status = pure line builder; wrapper = one chokepoint.
- **Dependency hygiene (9):** zero new deps; classifier-health clones voyage-health idiom; no circular imports (lazy require).

_Verified: 2026-07-21T23:55:00Z_
_Verifier: Claude (gsd-verifier scope:general)_
