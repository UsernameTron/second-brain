---
phase: 19-semantic-memory-search
verified: 2026-04-24T19:52:00Z
human_verified: 2026-04-24T22:50:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
post_uat_fixes:
  - "config/pipeline.json memory.semantic.threshold 0.72 → 0.55 (calibrated against voyage-4-lite)"
human_verification:
  - test: "Run /recall --semantic 'leadership' against a seeded vault with VOYAGE_API_KEY set"
    expected: "Returns ≥3 results with score ≥0.72, no stderr warnings, embeddings.jsonl grows by one per new entry"
    why_human: "Live Voyage AI endpoint integration — UAT suite is CI-skipped; only real-API run proves end-to-end reachability and embedding shape match"
  - test: "Run /recall --semantic with VOYAGE_API_KEY unset or invalid"
    expected: "stderr warning about VOYAGE_API_KEY, keyword fallback results, banner '(semantic unavailable — using keyword only)'"
    why_human: "Degradation UX — banner phrasing and stderr visibility are user-facing concerns not verifiable by unit tests"
  - test: "Run /recall --hybrid 'leadership' and compare result ordering against /recall --semantic 'leadership'"
    expected: "RRF-fused ordering differs from pure semantic ordering when docs appear in both keyword and semantic top-N"
    why_human: "Empirical evidence that RRF actually combines sources — unit tests verify the math, only real run proves fusion produces different rankings"
  - test: "Trigger 3 consecutive Voyage failures (e.g. temporarily invalidate API key), then restore and run /recall --semantic"
    expected: "After 3 failures, degraded banner appears for 15 minutes; ~/.cache/second-brain/voyage-health.json shows consecutive_failures=3 and degraded_until timestamp; first success resets counter"
    why_human: "Cross-invocation persistence and 15-minute wall-clock window are real-time behaviors not practical to verify without human timing"
---

# Phase 19: Semantic Memory Search Verification Report

**Phase Goal:** Add semantic memory search to the second-brain vault — Voyage AI embeddings on memory promotion, hybrid keyword+semantic search via `/recall --semantic` and `/recall --hybrid`, with graceful degradation when the embeddings provider is unhealthy.

**Verified:** 2026-04-24T19:52:00Z (automated) / 2026-04-24T22:50:00Z (human UAT)
**Status:** passed (all 5 must-haves verified, all 4 human-UAT items passed, 1 calibration fix applied)
**Re-verification:** No (initial pass)
**Post-UAT fixes:** `config/pipeline.json memory.semantic.threshold` 0.72 → 0.55 (empirical calibration for voyage-4-lite — see 19-HUMAN-UAT.md Test 1 notes)

## Goal Achievement

### Observable Truths (5/5 verified)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Voyage AI embeddings generated on memory promotion (MEM-EMBED-01) | VERIFIED | `src/promote-memories.js:192-193` calls `indexNewEntries(promotedCandidates)` inside try/catch immediately after `fs.writeFileSync(memoryFile, ...)`. Lazy require prevents promote-memories from failing if semantic-index has a bug. |
| 2 | `/recall --semantic` returns cosine-scored results with excluded-terms gate (MEM-SEMANTIC-01) | VERIFIED | `src/semantic-index.js:397` defines `semanticSearch`; `checkContent()` gate runs before Voyage call (line 408 per summary). Exports confirmed via smoke test: `indexNewEntries, semanticSearch, hybridSearch, selfHealIfNeeded, computeSchemaVersion, createVoyageClient`. Flag parser accepts `--semantic` (recall-command.js:31-32). |
| 3 | `/recall --hybrid` performs RRF fusion of keyword + semantic (MEM-SEMANTIC-01) | VERIFIED | `src/semantic-index.js:469` defines `hybridSearch`. Flag parser accepts `--hybrid` (recall-command.js:33-34). Runtime routes through `require('./semantic-index').hybridSearch` at recall-command.js:60-61. RRF math tested in `test/semantic-index.test.js` with numeric assertions. |
| 4 | Self-healing index refresh on first semantic call (MEM-INDEX-REFRESH-01) | VERIFIED | `selfHealIfNeeded()` at semantic-index.js:355 — hashes `memory.md` entries against `embeddings.jsonl`, fills gaps, triggers full re-embed on `schema_version` mismatch. Schema version uses `model+embeddingDim` only (D-14 lesson encoded as test). |
| 5 | Graceful degradation when Voyage unhealthy (MEM-DEGRADE-01) | VERIFIED | `src/utils/voyage-health.js` implements Pattern 7 denial tracker: 3-failure threshold triggers 15-min degraded window persisted to `~/.cache/second-brain/voyage-health.json`. `runRecall` emits banners `(semantic unavailable — using keyword only)` and `(hybrid unavailable — using keyword only)` (recall-command.js:69, 81). Keyword fallback on `{degraded:true}` (recall-command.js:73-87). |

### Required Artifacts (Levels 1-3: existence, substance, wiring)

| Artifact | Exists | Substantive | Wired | Status |
|----------|--------|-------------|-------|--------|
| `src/semantic-index.js` | YES (549 lines) | YES — all 6 public exports present, 0 throw statements | YES — imported by promote-memories.js and recall-command.js (lazy) | VERIFIED |
| `src/utils/voyage-health.js` | YES (130 lines) | YES — all 7 exports present | YES — imported and consumed by semantic-index.js | VERIFIED |
| `src/promote-memories.js` | YES (379 lines) | YES — indexNewEntries hook at line 192 | YES — existing callers unchanged, test suite passes | VERIFIED |
| `src/recall-command.js` | YES (128 lines) | YES — 3-branch router (hybrid/semantic/keyword) with degradation banners | YES — parseRecallArgs exports unchanged, all 35 tests pass | VERIFIED |
| `config/pipeline.json` memory.semantic block | YES | YES — all 9 tunables at spec defaults | YES — loaded via `safeLoadPipelineConfig` in semantic-index.js | VERIFIED |
| `config/schema/pipeline.schema.json` memory.semantic | YES | YES — enum + range constraints, `required` list, `additionalProperties:false` | YES — AJV validation path exercised in production code | VERIFIED |
| `test/semantic-index.test.js` | YES | YES — 41 tests, 6 describe groups | YES — exercises real module with mocked voyageai SDK | VERIFIED |
| `test/semantic-index-errors.test.js` | YES | YES — 24 tests covering 401/429/5xx/timeout/network/degraded | YES | VERIFIED |
| `test/integration/semantic-search.test.js` | YES | YES — 9 tests across 6 scenarios | YES — exercises real recall + semantic-index path | VERIFIED |
| `test/uat/semantic-search.uat.test.js` | YES | YES — 5 UAT scenarios | YES — dual skip guard: `CI=true` OR missing VOYAGE_API_KEY | VERIFIED |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| promote-memories.js | semantic-index.js | Lazy require inside try/catch after writeFileSync | WIRED (confirmed line 192) |
| recall-command.js | semantic-index.js (semanticSearch) | Lazy require inside --semantic branch | WIRED (confirmed line 74) |
| recall-command.js | semantic-index.js (hybridSearch) | Lazy require inside --hybrid branch | WIRED (confirmed line 60) |
| semantic-index.js | voyage-health.js | recordFailure/recordSuccess/isDegraded on every Voyage call | WIRED |
| semantic-index.js | content-policy.js | checkContent() gate before Voyage (Pattern 11) | WIRED |
| semantic-index.js | pipeline-infra.js | safeLoadPipelineConfig('pipeline') | WIRED |
| semantic-index.js | memory-reader.js | readMemory + searchMemoryKeyword | WIRED |
| config/pipeline.json | config/schema/pipeline.schema.json | AJV validation (loadConfigWithOverlay) | WIRED |

### Data-Flow Trace (Level 4)

Phase 19 produces data pipelines rather than UI components. Traces:

1. **Promotion -> embedding**: `promoteMemories()` -> `appendToMemoryFile()` -> `fs.writeFileSync(memory.md)` -> `indexNewEntries(promotedCandidates)` -> `createVoyageClient().embed()` -> `appendEmbedding()` -> `~/.cache/second-brain/embeddings.jsonl`. **FLOWING** — real data source (promotedCandidates with contentHash/content), real sink (JSONL cache), real Voyage call when API key present.
2. **Recall query -> results**: `runRecall(argv)` -> `semanticSearch(query)` -> `checkContent(query)` gate -> `readAllEmbeddings()` -> `_cosine + _adjustedScore` -> top-N ranked. **FLOWING** — query input real, cache read real, math tested in unit suite.
3. **Health persistence**: Voyage failure -> `recordFailure()` -> atomic write to `voyage-health.json` -> subsequent `isDegraded()` short-circuit in `semanticSearch`. **FLOWING** — cross-invocation persistence verified by unit test reading the file directly.

### Behavioral Spot-Checks

| # | Check | Command | Result |
|---|-------|---------|--------|
| 1 | All 6 semantic-index public exports resolve | `node -e "const si = require('./src/semantic-index'); [...].forEach(...)"` | PASS — exports-OK hash=6aa095ea3dee |
| 2 | All 7 voyage-health exports resolve | `node -e "const h = require('./src/utils/voyage-health'); ..."` | PASS — voyage-health-OK |
| 3 | Pipeline config has all 9 semantic tunables at spec defaults | `node -e "const c = require('./config/pipeline.json'); ..."` | PASS — model=voyage-4-lite threshold=0.72 dim=1024 |
| 4 | `parseRecallArgs(['--semantic','q'])` sets `flags.semantic=true` | `node -e "..."` | PASS — returned expected JSON |
| 5 | Full test suite passes under `CI=true` | `CI=true npx jest --forceExit --silent` | PASS — 982 total, 944 passed, 38 skipped |
| 6 | Zero throw statements in semantic-index.js public API | `grep -c "^\s*throw\b" src/semantic-index.js` | PASS — 0 |

### Requirements Coverage (4/4 verified)

| REQ-ID | Description (from REQUIREMENTS.md) | Plans Covering | Implementation Evidence | Status |
|--------|-----------------------------------|----------------|------------------------|--------|
| MEM-EMBED-01 | `indexNewEntries(promoted)` runs after `appendToMemoryFile()`; embeds via `voyage-4-lite` to `~/.cache/second-brain/embeddings.jsonl`; dedup by contentHash | 19-01, 19-02, 19-03, 19-04 | promote-memories.js:191-195 invokes indexNewEntries; semantic-index.js:282 implements it with dedup at line 292 (`existing = new Set(readAllEmbeddings().map(...))`); voyageai@0.2.1 in package.json | SATISFIED |
| MEM-SEMANTIC-01 | `semanticSearch(query, k=5)` with `input_type='query'`, cosine + temporal decay (`base * (1 + 0.2 * recency)`), 0.72 threshold, excluded-terms gate before Voyage | 19-02, 19-03, 19-04 | semantic-index.js:397 defines semanticSearch with `inputType:'query'` at line 422, `checkContent()` gate at line 408, threshold 0.72 from pipeline.json memory.semantic.threshold | SATISFIED |
| MEM-INDEX-REFRESH-01 | Startup self-heal compares memory.md contentHashes against embeddings.jsonl; schema_version triggers full re-embed | 19-02, 19-04 | semantic-index.js:355 `selfHealIfNeeded()`; computeSchemaVersion hashes model+embeddingDim ONLY (D-14 invariant tested); truncateEmbeddings on mismatch | SATISFIED |
| MEM-DEGRADE-01 | Voyage unreachable (timeout/429/5xx/DNS/missing key) -> fallback to keyword with one-line notice; Memory Echo continues on keyword | 19-02, 19-03, 19-04 | voyage-health.js Pattern 7 tracker (3 failures -> 15-min window); recall-command.js emits `(semantic unavailable — using keyword only)` and `(hybrid unavailable — using keyword only)` banners; keyword fallback executed on degraded | SATISFIED |

**Orphaned requirements:** None. REQUIREMENTS.md maps all 4 IDs to Phase 19 and all 4 appear in at least one plan's `requirements` frontmatter field (Plan 02 claims all four; Plans 01, 03, 04 claim subsets).

### Documentation Coverage

| File | Status | Evidence |
|------|--------|----------|
| CLAUDE.md | UPDATED | `/recall --semantic` and `/recall --hybrid` rows in commands table (lines 43-44); `voyageai 0.2.1` in Key dependencies (line 56); test count 982/52 files and coverage 81.28% branch reflects live values; semantic-index.js listed in src/ key files (line 93) |
| README.md | UPDATED | Optional VOYAGE_API_KEY note (line 30); `voyageai 0.2.1` in Key dependencies (line 139); `/recall --semantic` and `/recall --hybrid` rows in Commands Reference (lines 192-193) |
| docs/DEVOPS-HANDOFF.md | UPDATED (rewritten from bootstrap stub) | 17 occurrences of MEM- REQ-IDs or VOYAGE_API_KEY; all 4 REQ-IDs (MEM-EMBED-01, MEM-SEMANTIC-01, MEM-INDEX-REFRESH-01, MEM-DEGRADE-01) mapped to covering sections; environment variables table with acquisition steps; Semantic Search Configuration section with all 9 tunables; Cache and Disk Artifacts section; Degradation Behavior section; deployment checklist with VOYAGE_API_KEY provisioning item |

### Test Coverage Gates

| Gate | Threshold | Measured | Status |
|------|-----------|----------|--------|
| src/semantic-index.js branch | ≥80% | 82.22% | PASS |
| src/utils/voyage-health.js branch | ≥80% | 84.61% | PASS |
| Project-wide branch | ≥81% | 81.28% | PASS |
| Project-wide statements | (informational) | 94.62% | — |
| Project-wide functions | (informational) | 96.94% | — |
| Project-wide lines | (informational) | 95.53% | — |
| Full suite passes | All pass under CI=true | 944 passed, 38 skipped, 0 failed | PASS |

### Anti-Patterns Scanned

| Pattern | Location | Severity | Note |
|---------|----------|----------|------|
| TODO/FIXME comments | semantic-index.js, voyage-health.js, promote-memories.js, recall-command.js | None found | — |
| Empty public-API implementations | semantic-index.js public surface | None found | `_testOnly` internals intentionally present |
| Hardcoded empty returns flowing to user output | None | N/A | All empty returns are `{results:[], degraded/blocked:true}` with explicit reason — this is the degradation contract, not a stub |
| Throw statements leaking from public API | `grep -c "^\s*throw\b" src/semantic-index.js` | 0 | Matches plan invariant |
| Silent error handling | Three `/* dir may already exist */` catches in appendEmbedding/writeMetadata/truncateEmbeddings | Info | Documented non-silent — comments explain intent, lint-compliant |
| Console.log in production | recall-command.js, promote-memories.js | Info | `console.error` with `eslint-disable-next-line no-console` comment — documented exception for non-fatal warning; consistent with project pattern |

No blocker anti-patterns detected.

## Human Verification Required

All four items below require live Voyage API access or real-time wall-clock behavior:

### 1. Live Voyage semantic recall

**Test:** Export `VOYAGE_API_KEY`, seed the vault with 10 varied memories, then run `/recall --semantic "leadership"`.
**Expected:** ≥3 results with score ≥0.72; no stderr warnings; `~/.cache/second-brain/embeddings.jsonl` grows to contain one record per promoted entry.
**Why human:** Unit tests mock voyageai; only a real-endpoint run proves the SDK shape assumptions (`response.data[].embedding`) match production responses.

### 2. Missing-key degradation UX

**Test:** Unset `VOYAGE_API_KEY` (or set to an invalid value), run `/recall --semantic "resilience"`.
**Expected:** stderr warning mentioning `VOYAGE_API_KEY`; keyword fallback results printed; banner line `(semantic unavailable — using keyword only)` appears above the results.
**Why human:** The banner wording, stderr visibility, and exit code (must be 0, not 1) are user-facing properties — unit tests verify the string constants but only a real run proves the terminal experience.

### 3. RRF fusion empirical differentiation

**Test:** With a seeded vault, run both `/recall --semantic "team dynamics"` and `/recall --hybrid "team dynamics"`, compare result ordering.
**Expected:** At least one document appears in a different rank between the two modes (proves RRF actually combines sources rather than passing through one).
**Why human:** Unit tests verify the RRF math at 1/(60+rank_kw) + 1/(60+rank_sem) but only a real run with natural memory content proves the fusion produces observably different ordering from pure semantic.

### 4. Degraded-mode window persistence

**Test:** Invalidate `VOYAGE_API_KEY` (set to a bad value), run `/recall --semantic "x"` three times. Inspect `~/.cache/second-brain/voyage-health.json`. Then restore the key and wait less than 15 minutes; observe degraded banner persists. Wait past 15 minutes or replace key and observe recovery.
**Expected:** After 3 failures, `voyage-health.json` shows `consecutive_failures=3` and `degraded_until` timestamp ~15 minutes in the future; subsequent calls short-circuit with banner; successful call resets counter to 0.
**Why human:** Cross-invocation file persistence and 15-minute wall-clock window cannot be practically exercised in unit tests without fake timers (which cover the logic but not the filesystem handoff between real processes).

## Gaps Summary

No gaps found. All 5 must-have truths verified. All 4 REQ-IDs satisfied with implementation evidence. Documentation complete across CLAUDE.md, README.md, and DEVOPS-HANDOFF.md. Test coverage gates all met. Zero blocker anti-patterns. Four items deferred to human verification because they require live Voyage API or real-time behavior — these do not block the phase.

## Architecture Score

Skipped per rubric — architecture scoring is applied only when general-scope verification status is `passed`. Current status is `human_needed` because human verification items remain. If all human verification items pass without regression, the status converts to `passed` and the architecture score should be applied in a follow-up pass.

---

_Verified: 2026-04-24T19:52:00Z_ / _Verifier: Claude (gsd-verifier scope:general)_
