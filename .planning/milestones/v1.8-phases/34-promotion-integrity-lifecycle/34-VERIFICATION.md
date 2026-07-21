---
phase: 34-promotion-integrity-lifecycle
verified: 2026-07-20T00:00:00Z
status: passed
score: 8/8 must-haves verified
human_verification:
  - test: "Install and load the monthly propose plist: cp config/com.secondbrain.dream.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/com.secondbrain.dream.plist"
    expected: "com.secondbrain.dream scheduled Day 1 07:15, --propose only; monthly changeset appears in proposals/ for review"
    why_human: "launchctl load is an operator action; the plist is committed (RunAtLoad false) but intentionally not loaded by the executor"
  - test: "node scripts/dream.js --dry-run against the live vault (~7 min, real Sonnet/Voyage calls)"
    expected: "exit 0; memory.md, proposals/memory-proposals.md, and state/dream-ledger.json mtimes unchanged"
    why_human: "Requires live API keys and ~7 min runtime; side-effect-free is structurally enforced (all writes gated behind !dryRun) and unit-tested, and was verified live by the executor (34-06). Re-confirm on the operator's machine if desired."
---

# Phase 34: Promotion Integrity & Lifecycle Verification Report

**Phase Goal:** Land backlog PROMOTE-PARSE-01 / PROMOTE-VAULT-01 / PROMOTE-ID-01 / VERIFY-SENTINEL-01; flag-only contradiction check at promotion (hybrid top-5, never block/auto-resolve); `superseded-by::` downrank convention; monthly snapshot-first dream-consolidation (propose script + launchd plist, stages for human review, no auto-apply).
**Verified:** 2026-07-20
**Status:** passed
**Re-verification:** No

## Goal Achievement

### Observable Truths (8/8 verified)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Exactly ONE checkbox parser, called by both gates | ✓ VERIFIED | `parseCheckboxState` defined once (memory-proposals.js:64); promote-memories.js:124 and dream.js `parseChangesetOps` (523→531) both call it. dream.js:814 is a box-*rewrite* (`_revertOpsToUnresolved`), not a state decision — op selection routes through `parseCheckboxState` (dream.js:745 `status === 'accepted'`). |
| 2 | PROMOTE-PARSE-01: whitespace-tolerant + loud near-miss abort | ✓ VERIFIED | Runtime probe: all 6 whitespace variants parse `accepted`; `[y]`→null nm=1; empty `[ ]`→null nm=0; multi-box→ambiguous. Batch of unparseables returns `{error:'PROMOTE-PARSE-01...'}` + `console.error(...unparseable-checkboxes...)` (promote-memories.js:439-440). |
| 3 | PROMOTE-VAULT-01/ID-01: call-time root + agreement assert; collision-safe IDs | ✓ VERIFIED | `VAULT_ROOT = () =>` (memory-proposals.js:21); agreement assert throws on mismatch (promote-memories.js:404-408). `generateCandidateId` scans proposals file + PROPOSAL_ARCHIVE_DIR for global max NNN (memory-proposals.js:100-130). |
| 4 | VERIFY-SENTINEL-01: real exit-coded check, pre-push wired | ✓ VERIFIED | `VAULT_ROOT="$HOME/Claude Cowork" node scripts/verify-baseline.js` → `27/27 baseline hashes resolve`, exit 0. Pre-push gate hooks/pre-push:33-38 with `SKIP_BASELINE` bypass. 27 real hashes committed in eval/baseline-sentinel-hashes.json. |
| 5 | superseded-by::/stale:: downrank in search + echo, never filter | ✓ VERIFIED | `DOWNRANK_FACTOR = 0.4` applied in searchMemoryKeyword (memory-reader.js:278) and getMemoryEcho (:358); readMemory surfaces both fields (:167,172). No `.filter()` drops superseded/stale entries. |
| 6 | Contradiction flag-only at promotion (append independent of check) | ✓ VERIFIED | `appendToMemoryFile` runs at promote-memories.js:508 (unconditional); contradiction loop runs *after* at :515-522, only pushing flags. Never blocks, never auto-resolves. Uses shared `checkContradiction`. |
| 7 | Dream propose: refuse-on-unresolved, zero writes on dry-run, changeset format | ✓ VERIFIED | runPropose refuses on `hasUnresolvedChangeset()` (scripts/dream.js:70); writeChangeset/ledger/staging all gated behind `!dryRun` (:102-113). Changeset format + golden-hash stamp match design doc. Unit tests cover fabricated-quote drop, refuse-on-unresolved, ambiguous-skip. |
| 8 | Dream apply: snapshot-first, sequence matches design, eval-gate auto-restore, human-only | ✓ VERIFIED | runApply: snapshot (scripts/dream.js:156) before applyOps (:159); MERGE supersedes-not-deletes (dream.js:770), STALE flags; regenerateAutoIndex+indexNewEntries inside applyOps (:791-794); build-index --strict + reach export; runEvalGate auto-restores on exit 1 (dream.js:851-870). `--apply` absent from plist/scheduling. Skills disambiguate vault memory.md vs Claude Code MEMORY.md. |

### Required Artifacts

| Artifact | Exists | Substantive | Wired | Status |
|----------|--------|-------------|-------|--------|
| src/memory-proposals.js (parseCheckboxState, call-time root, ID scan) | ✓ | ✓ | ✓ | VERIFIED |
| src/memory-reader.js (downrank) | ✓ | ✓ | ✓ | VERIFIED |
| scripts/verify-baseline.js + eval/baseline-sentinel-hashes.json | ✓ | ✓ | ✓ (pre-push) | VERIFIED |
| src/contradiction-check.js | ✓ | ✓ | ✓ (promote + dream) | VERIFIED |
| src/dream.js (detect/author/merge/stale/patterns/apply) | ✓ | ✓ | ✓ | VERIFIED |
| scripts/dream.js (--propose/--dry-run/--apply) | ✓ | ✓ | ✓ | VERIFIED |
| config/pipeline.json dream block | ✓ | ✓ (locked values exact) | ✓ (schema) | VERIFIED |
| config/com.secondbrain.dream.plist (propose-only) | ✓ | ✓ | operator-load | VERIFIED |
| .claude/skills/dream-propose + dream-apply SKILL.md | ✓ | ✓ (store-disambiguated) | ✓ | VERIFIED |

### Behavioral Spot-Checks

| Check | Result |
|-------|--------|
| PARSE-01 whitespace/near-miss probe (9 cases) | PASS |
| `verify-baseline.js` against live vault | PASS (27/27, exit 0) |
| Full test suite (`npm test`) | PASS (1412 passed, 29 skipped) |
| `npm run lint` | PASS (0 errors, 9 pre-existing jest/expect-expect warnings in test files) |

### Named Design Tests (all present and green)

fabricated-quote merge dropped (dream.test.js:139); CONSTRAINT never age-flagged (:193); MERGE supersede-not-delete (dream-apply.test.js:127); snapshot→restore byte-identical (:184); apply→eval-fail→restore round-trip (:197); applied:: no-double-apply (:170); refuse-on-unresolved (runPropose gate).

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| PROMOTE-PARSE-01 | ✓ SATISFIED | Truth 2 |
| PROMOTE-VAULT-01 | ✓ SATISFIED | Truth 3 (call-time root + assert) |
| PROMOTE-ID-01 | ✓ SATISFIED | Truth 3 (archive-aware ID scan) |
| VERIFY-SENTINEL-01 | ✓ SATISFIED | Truth 4 |
| CONTRADICT-CHECK-01 (roadmap bullet 2) | ✓ SATISFIED | Truth 6 |
| SUPERSEDED-CONVENTION-01 (roadmap bullet 3) | ✓ SATISFIED | Truth 5 |
| DREAM-CONSOLIDATION-01 (roadmap bullet 4) | ✓ SATISFIED | Truths 7, 8 |

### Anti-Patterns Found

None. No stubs, no orphaned artifacts, no dead checkbox-regex paths. `--apply` correctly absent from all schedules.

### Human Verification Required

1. Load the monthly propose plist (operator action — see frontmatter).
2. Optional: live `--dry-run` re-confirmation (~7 min, needs API keys; already structurally enforced + unit-tested + executor-verified live).

### Gaps Summary

None.

## Architecture Score

| Dimension | Weight | Score | Status |
|-----------|--------|-------|--------|
| Security | 35% | 88 | PASS |
| Performance | 25% | 82 | PASS |
| Correctness | 25% | 90 | PASS |
| Maintainability | 15% | 90 | PASS |
| **Overall** | **100%** | **87.4** | **PASS** |

### Criteria Detail

- **Input validation (9):** whitespace-tolerant checkbox parse with loud near-miss abort closes the silent-`promoted 0` class; VAULT_ROOT agreement assert throws before any I/O.
- **Permission boundaries (9):** apply is human-only, never scheduled; sources superseded-not-deleted; snapshot-first with auto-restore backstop.
- **Secret handling (8):** never-throws LLM clients degrade to LM Studio; no credentials in code.
- **Resource bounds (8):** maxLLMCalls (40) hard breaker, per-op caps (maxMergeOps 15 / maxStaleFlags 10 / maxPatternAdds 5), batch cap 5-10 on apply.
- **Concurrency (8):** proposals lock reused around apply guards concurrent wrap/promote writes.
- **Error handling (9):** eval-gate exit 1 → byte-identical snapshot restore + op-status revert; changeset is single source of truth for applied-state via `applied::` marker.
- **Edge cases (9):** fabricated-quote mechanical guard, empty-box-not-near-miss, refuse-on-unresolved, idempotent re-apply.
- **Test coverage (9):** 1412 passing; every named design test present.
- **Single responsibility / dependency hygiene (9):** one shared checkbox parser (operator hard constraint honored), one shared contradiction helper; additive exports (readAllEmbeddings, regenerateAutoIndex) rather than reaching into test seams; zero new deps.

_Verified: 2026-07-20_
_Verifier: Claude (gsd-verifier scope:general)_
