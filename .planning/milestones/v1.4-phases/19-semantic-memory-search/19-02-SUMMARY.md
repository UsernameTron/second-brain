---
phase: 19-semantic-memory-search
plan: "02"
subsystem: semantic-memory
tags: [voyageai, embeddings, semantic-search, hybrid-search, RRF, degradation, cosine, temporal-decay]

# Dependency graph
requires:
  - phase: 19-semantic-memory-search
    plan: "01"
    provides: voyageai@0.2.1 dep, pipeline.json memory.semantic block, AJV schema validation
  - phase: 18-memory-retrieval-foundation
    provides: memory-reader.js (readMemory, searchMemoryKeyword), content-policy.js (checkContent), pipeline-infra.js (safeLoadPipelineConfig)
provides:
  - src/utils/voyage-health.js — cross-invocation denial tracker (Pattern 7)
  - src/semantic-index.js — embed/search/hybrid/self-heal engine
  - embeddings.jsonl at ~/.cache/second-brain/ (written at runtime)
affects: [19-03-promote-embed, 19-04-recall-semantic, 19-05-uat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pattern 7 (Adaptive Denial Tracking): consecutive-failure counter with degraded-mode window persisted cross-invocation"
    - "Pattern 11 (Excluded-Terms Perimeter): checkContent() runs on every query BEFORE any Voyage API call"
    - "Pattern 12 (Lazy Prompt Loading): selfHealIfNeeded() runs on first semantic call per process only"
    - "RRF fusion: 1/(60+rank_kw) + 1/(60+rank_sem) per Cormack & Clarke 2009 (D-04)"
    - "D-14 schema version: hashes model+embeddingDim ONLY — not threshold/recencyDecay (query-time math)"
    - "No-throw public API: all Voyage failures return {success:false, failureMode} structured objects"

key-files:
  created:
    - src/utils/voyage-health.js
    - src/semantic-index.js
  modified: []

key-decisions:
  - "voyage-health.js persists consecutive_failures + degraded_until to ~/.cache/second-brain/voyage-health.json; atomic write via .tmp rename with chmod 0600/0700"
  - "computeSchemaVersion hashes model+embeddingDim ONLY (D-14 correction) — threshold/recencyDecay changes do not invalidate embeddings"
  - "checkContent gate runs BEFORE Voyage call in semanticSearch() — excluded terms never leave the process (Pattern 11)"
  - "429 retry: honor Retry-After only when <=2s (D-08); otherwise immediate fallback to preserve /recall latency budget"
  - "Empty catch blocks use /* dir may already exist */ comment to satisfy ESLint no-empty rule (auto-fix deviation Rule 1)"

# Metrics
duration: 5min
completed: 2026-04-24
---

# Phase 19 Plan 02: Core Engine (voyage-health + semantic-index) Summary

**Voyage health tracker (Pattern 7) and semantic-index engine (embed-on-promotion, lazy self-heal, cosine+temporal-decay search, RRF hybrid fusion, excluded-terms gate, structured error returns) — Plan 03 can now `require('./semantic-index')` and wire embed-on-promotion into promote-memories.js**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-24T19:09:56Z
- **Completed:** 2026-04-24T19:14:24Z
- **Tasks:** 2
- **Files created:** 2 (src/utils/voyage-health.js, src/semantic-index.js)
- **Files modified:** 0

## Accomplishments

- Created `src/utils/voyage-health.js` (130 lines): cross-invocation Voyage denial tracker. `recordFailure()` increments counter, trips to degraded mode at threshold 3 (D-10). `recordSuccess()` resets. Atomic write via `.tmp` rename. `CACHE_DIR_OVERRIDE` honored for test isolation. All fs ops in try/catch — no throws from public API.

- Created `src/semantic-index.js` (549 lines): full Phase 19 engine. Exports: `indexNewEntries`, `semanticSearch`, `hybridSearch`, `selfHealIfNeeded`, `computeSchemaVersion`, `createVoyageClient`, `getEmbeddingsPath`, `getMetadataPath`. Internal `_testOnly` surface for test stubs: `_cosine`, `_adjustedScore`, `_daysSince`, `classifyVoyageError`, `extractRetryAfterSec`, `readAllEmbeddings`, `readMetadata`.

  Key behaviors verified:
  - `checkContent()` runs on every `semanticSearch()` query BEFORE any Voyage call
  - `computeSchemaVersion()` hashes `model + ':' + embeddingDim` only (D-14)
  - `inputType: 'query'` for embed-time queries; `inputType: 'document'` for indexNewEntries
  - 401 prints stderr remediation line; 429 with Retry-After ≤ 2s retries once
  - RRF fusion uses `1/(60+rank_kw) + 1/(60+rank_sem)`, dedupe by entry id, sum on overlap
  - Zero `throw` statements in public API surface

- Existing test suite: 866 passing, 45 suites — unchanged from pre-plan baseline.

## Task Commits

Each task committed atomically:

1. **Task 1: voyage-health.js — cross-invocation denial tracker** — `5d7bde4` (feat)
2. **Task 2: semantic-index.js — embed/search/RRF with degradation tracking** — `0826cac` (feat)

## Files Created/Modified

- `src/utils/voyage-health.js` — Pattern 7 health tracker: readHealth, recordFailure, recordSuccess, isDegraded, getDegradedReason, getHealthPath, getSemanticCacheDir, DEGRADED_FAILURE_THRESHOLD
- `src/semantic-index.js` — Core engine: indexNewEntries, semanticSearch, hybridSearch, selfHealIfNeeded, computeSchemaVersion, createVoyageClient, path helpers, _testOnly internals

## Decisions Made

- **Atomic write pattern in voyage-health.js**: Write to `.tmp` then `fs.renameSync` to final path — prevents corrupt reads if process dies mid-write. chmod 0600 on file, 0700 on dir (matches project cache security posture).
- **`computeSchemaVersion` uses model+dim only (D-14)**: threshold and recencyDecay are query-time scoring math; changing them does not require re-embedding the vault. Only a model swap or dimension change invalidates the stored vectors.
- **No-throw public API throughout semantic-index.js**: Every Voyage failure returns `{success:false, failureMode}`. Every config-miss returns early with `{results:[], degraded:true}`. Plan 03 and 04 can call these without try/catch wrappers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed ESLint `no-empty` errors from empty catch blocks in semantic-index.js**
- **Found during:** Post-implementation `npm run lint`
- **Issue:** Three `try { ... } catch (_) {}` one-liners produced `no-empty` errors (ESLint exit 1)
- **Fix:** Added `/* dir may already exist */` and `/* file may not exist yet */` comments inside catch bodies — satisfies `no-empty` while preserving intent
- **Files modified:** `src/semantic-index.js` (3 one-liner catches in `appendEmbedding`, `writeMetadata`, `truncateEmbeddings`)
- **Verification:** `npm run lint -- --quiet` exits 0

---

**Total deviations:** 1 auto-fixed (Rule 1 — lint gate)
**Impact on plan:** No scope change. Files, exports, and behavior unchanged.

## Known Stubs

None. All public exports are fully implemented. No TODOs, FIXMEs, placeholder values, or stub patterns in created files.

---

## Self-Check: PASSED

Files verified:
- `src/utils/voyage-health.js` — FOUND (130 lines, all 7 exports confirmed)
- `src/semantic-index.js` — FOUND (549 lines, all 6 public exports confirmed, 0 throw statements)

Commits verified:
- `5d7bde4` — voyage-health.js (feat)
- `0826cac` — semantic-index.js (feat)

Acceptance criteria:
- voyage-health.js under 160 lines: YES (130)
- semantic-index.js under 550 lines: YES (549)
- checkContent gate before Voyage in semanticSearch: VERIFIED (line 408)
- inputType='query' in semantic query path: VERIFIED (line 422)
- inputType='document' in indexNewEntries: VERIFIED (lines 304, 318)
- computeSchemaVersion uses model+dim only: VERIFIED (no threshold/recencyDecay in hash input)
- Zero throw statements in public API: VERIFIED (grep returns 0)
- npm run lint exits 0: VERIFIED
- Smoke test values correct: computeSchemaVersion=12-char hex, cosine same=1, cosine diff=0

Stub scan: No TODOs, FIXMEs, throw-not-implemented, or placeholder values found.

---
*Phase: 19-semantic-memory-search*
*Completed: 2026-04-24*
