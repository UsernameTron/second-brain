---
phase: 35-proactive-memory
verified: 2026-07-21T00:00:00Z
status: passed
score: 7/7 must-have truths verified
requirements:
  INJECT-HOOK-01: satisfied
  INJECT-EGRESS-01: satisfied
  INJECT-KILL-01: satisfied
requirements_note: "IDs are plan-derived (not pre-mapped in REQUIREMENTS.md), mirroring the CAP-* derivation used for Phase 33. Recorded here for traceability."
human_verification:
  - test: "Start a fresh Claude Code session in this repo and confirm a '## Recalled memory (proactive)' block appears (Voyage up) or is silently absent (degraded/empty) — never an error."
    expected: "Session start shows the injected digest when relevant memories exist; on any infra failure the session starts normally with no injected text and no error."
    why_human: "SessionStart stdout→context injection can only be observed in a live interactive session, not at verification time. The hook's exit-0 fail-open path is unit-verified; the visible injection is the human-observable half."
---

# Phase 35: Proactive Memory Verification Report

**Phase Goal:** SessionStart hook `.claude/hooks/session-memory-inject.js` (fail-open, exit 0 always) that recalls top-5 hybrid memories for a project-derived query, passes every entry through the fail-closed `checkContent` egress gate, caps output at ~750 tokens by whole entries, is killable via `sessionInject.enabled=false` or `SB_SESSION_INJECT=0`, and skips (never hangs) on a latency budget (1000ms up / 250ms degraded). Recall is in-process via `runRecall({_internal:true})` so session starts do not inflate recall stats.
**Verified:** 2026-07-21 (HEAD 375833d, branch feat/phase-35-proactive-memory)
**Status:** passed
**Re-verification:** No

## Goal Achievement

### Observable Truths (7/7 verified)

| # | Truth (plan) | Status | Evidence |
|---|--------------|--------|----------|
| 1 | Hook runs on session start and ALWAYS exits 0, even when recall/config/network fails (fail-open) | PASS | `require.main` guard wraps everything in try/catch → `process.exit(0)`; config load failure → `process.exit(0)`; no `process.exit(1)` in file (grep count 0). Live: `SB_SESSION_INJECT=0 node …` exit=0 AND bare `node …` exit=0 |
| 2 | Retrieves top-5 hybrid recall for a project-derived query (`path.basename` of `CLAUDE_PROJECT_DIR` or cwd) | PASS | line 44 `runRecall([deps.query,'--hybrid','--top',String(deps.config.topN)],…)`; line 113 `query = path.basename(process.env.CLAUDE_PROJECT_DIR || process.cwd())`; topN=5 in config |
| 3 | Every entry printed first passed the fail-closed `checkContent` egress gate (BLOCK or throw → dropped, no crash) | PASS | line 75 per-entry `checkContent(\`${r.category} ${r.snippet}\`, excludedTerms)`; `verdict.decision !== 'PASS'` → skip; `catch → continue` (fail-closed). Tests: "one BLOCK verdict drops that entry" + "checkContent throwing … drops it, hook does not throw" |
| 4 | Injected text capped at ~750 tokens by whole entries — never mid-string truncation | PASS | line 68 `capChars = tokenCap*4`; line 82 `if (used + bullet.length + 1 > capChars) break` (whole entries only). Test: "token cap emits only whole entries that fit" asserts each emitted bullet contains the full original snippet |
| 5 | `sessionInject.enabled=false` OR `SB_SESSION_INJECT=0` → zero injected output | PASS | lines 35-40 short-circuit both to `{text:'',skipped:true}` before any recall. Tests: both kill-switch cases assert `skipped:true` AND `runRecall` NOT called |
| 6 | Skipped (not hung) when recall exceeds latency budget: 1000ms up / 250ms degraded | PASS | line 42 `budgetMs = isDegraded() ? latencyDegradedMs : latencyUpMs`; `Promise.race(recallP, timeoutP)` → `__timeout` → `{skipped, reason:'latency'}`. Tests: never-settling recall skips with reason 'latency'; degraded-budget test asserts elapsed < 500ms |
| 7 | Derived query never written to any cache/log/stats (`runRecall` with `_internal:true`) | PASS | line 44 second arg `{ _internal: true }` (test asserts exact call args incl. `_internal:true`); hook has 0 `fs.`/`writeFile`/`appendFile`/`console.` references (grep count 0) — query is never persisted or logged |

### Required Artifacts

| Artifact | Exists | Substantive | Wired | Status |
|----------|--------|-------------|-------|--------|
| .claude/hooks/session-memory-inject.js | Y | Y (128 lines; DI pure core + require.main guard, exit 0 always) | Y (registered in settings.json SessionStart) | VERIFIED |
| test/hooks/session-memory-inject.test.js | Y | Y (14 tests, all behaviors, DI fakes, no network) | Y (imports the hook) | VERIFIED |
| config/pipeline.json (sessionInject) | Y | Y (enabled/topN/tokenCap/latencyUpMs/latencyDegradedMs) | Y (loadConfigWithOverlay reads it) | VERIFIED |
| config/schema/pipeline.schema.json (sessionInject) | Y | Y (typed, required[], additionalProperties:false) | Y (in top-level required[]; negative test rejects bad config) | VERIFIED |
| .claude/settings.json (registration) | Y | Y (2nd SessionStart entry, staleness-check retained) | Y (valid JSON, command references hook) | VERIFIED |

### Key-Link Wiring

| From | To | Pattern | Status |
|------|-----|---------|--------|
| hook | src/recall-command.runRecall | `runRecall([query,'--hybrid','--top','5'], {_internal:true})` | WIRED (line 44) |
| hook | src/content-policy.checkContent | per-entry fail-closed egress | WIRED (line 75) |
| hook | src/utils/voyage-health.isDegraded | latency budget selection | WIRED (line 42) |
| settings.json | hook | SessionStart hooks[].command | WIRED (line 56) |

## Test Evidence

- `npx jest test/hooks/session-memory-inject.test.js` → **14 passed**; isolated `--detectOpenHandles` clean (no leaked timers after fix a139db1).
- `npx jest test/hooks/` → **56 passed** (staleness-check unaffected).
- `npm test` (full suite) → **1479 passed, 29 skipped, 0 failed**.
- Config: `loadConfigWithOverlay('pipeline',{validate:true})` exits 0; negative test (string `topN`) is rejected — schema actually gates.
- Fail-open live: `node .claude/hooks/session-memory-inject.js` exits 0 with and without `SB_SESSION_INJECT=0`.

## Deviations / Notes

- **In-process recall (planner-locked):** the ROADMAP wording said "shelling to scripts/recall.js"; the plan deliberately uses in-process `runRecall({_internal:true})` — same observable behavior, but the only way to suppress the recall_count/recall_hits stats increment (Truth 7) and avoid a second Node boot in the latency-gated path. Accepted as designed.
- **Recovery:** the executor stalled mid-Task-3 under worktree isolation because this repo's Jest config ignores `.claude/worktrees` (tests undiscoverable there). Work was cherry-picked to the feat branch and completed inline; see 35-01-SUMMARY.md.
- **Pre-existing, out of scope:** full-suite "worker failed to exit gracefully" warning is present with the new hook test excluded (1494-total baseline) — not introduced by Phase 35.

## Verdict

All 7 must-have truths verified against code + tests; all 5 artifacts substantive and wired; all 4 key-links present; full suite green. One human-verification item (live session injection visibility) is recorded — the fail-open/exit-0 path is already unit-verified. **Phase goal achieved.**
