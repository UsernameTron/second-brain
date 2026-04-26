# Plan 21-02 SUMMARY — HYG-JSDOC-01

**Phase:** 21 — Closeout Hygiene
**Plan:** 02
**Requirement:** HYG-JSDOC-01
**Completed:** 2026-04-25
**Branch:** phase-21-02-hyg-jsdoc-01
**Base:** master @ 057de9e (PR #42 merge — Plan 21-01)

## What shipped

JSDoc (@param, @returns, one-line description) on every public symbol attached to `module.exports` across 10 named source files. The verbatim D-LOCK-3-AMEND-A `_testOnly` carve-out comment was applied at both `_testOnly` export sites (`memory-proposals.js`, `semantic-index.js`).

JSDoc-only edits — no function bodies modified, no logic touched, no refactors. Lock 5 fence preserved via post-edit `git diff` filter (only comment-line changes in `src/`).

## Acceptance criteria results

| ID | Check | Expected | Actual | Pass |
|----|-------|----------|--------|------|
| A1 | Lock 5 fence (only comment-line changes in `src/`) | empty diff | **empty** (all 10 deletions are pre-existing JSDoc lines being expanded) | ✓ |
| A2 | `_testOnly` carve-out in BOTH `memory-proposals.js` AND `semantic-index.js` | 2 matches | **2** | ✓ |
| A3 | per-file @param / @returns minimums | met for all 10 files | **all minimums met** | ✓ |
| A4 | vault-gateway non-function exports use @type/@class | ≥ 3 | **3** (VAULT_ROOT, VaultWriteError, configEvents) | ✓ |
| A5 | full test suite | 0 failed, no regression | **1044 passed, 38 skipped, 45 todo, 0 failed, 1127 total** | ✓ |
| A6 | `npm run lint` | exit 0 | **exit 0** (0 errors, 41 pre-existing warnings) | ✓ |
| A7 | every modified module loads | all OK | **all 10 modules: OK** | ✓ |

## Per-file delta (final @param + @returns counts)

| File | @param | @returns | @type/@class | Min met |
|------|--------|----------|--------------|---------|
| `src/memory-proposals.js` | 10 | 4 | – | ≥8/4 ✓ |
| `src/promote-memories.js` | 2 | 1 | – | ≥1/1 ✓ |
| `src/recall-command.js` | 4 | 2 | – | ≥2/2 ✓ |
| `src/today-command.js` | 12 | 4 | – | ≥1/1 ✓ |
| `src/memory-reader.js` | 7 | 5 | – | ≥3/3 ✓ |
| `src/classifier.js` | 14 | 5 | – | ≥4/4 ✓ |
| `src/memory-extractor.js` | 23 | 9 | – | ≥4 ✓ |
| `src/daily-stats.js` | 24 | 12 | – | ≥9 ✓ |
| `src/semantic-index.js` | 21 | 16 | – | ≥8 ✓ |
| `src/vault-gateway.js` | 25 | 14 | 3 | ≥14/14/3 ✓ |

Files modified in working tree: **7 of 10** (3 modules — `memory-reader.js`, `memory-extractor.js`, `classifier.js` — already had complete coverage per the strong-baseline classification in the plan brief; only the wave that needed construction or fill triggered file modifications).

## `_testOnly` carve-out comment confirmation (D-LOCK-3-AMEND-A)

Verbatim line applied at both export sites:

```
// Test-only seam — not public API. JSDoc not required per Phase 21 D-LOCK-3.
```

- `src/memory-proposals.js` — line preceding `module.exports._testOnly = { acquireLock, releaseLock };`
- `src/semantic-index.js` — line preceding the inline `_testOnly: { ... }` key inside the existing `module.exports = { ... }` literal

`grep -F "Test-only seam — not public API. JSDoc not required per Phase 21 D-LOCK-3." src/memory-proposals.js src/semantic-index.js` returned **2 matches** (one per file). Em-dash and exact phrasing preserved.

## Lock 5 fence verification

`git diff master -- src/` produced 83 insertions and 10 deletions. The acceptance grep `git diff master -- src/ | grep -E "^[+-]" | grep -vE "^(\+\+\+|---|@@|[+-][[:space:]]*(\*|//|/\*\*|\*/))"` returned **empty output** — confirming every changed line is a JSDoc comment, JSDoc-fence (`/**`, `*/`), or single-line comment. Zero function-body changes. Zero logic touched.

The 10 deletions are pre-existing JSDoc lines being replaced with expanded versions (e.g. partial `runRecall` JSDoc replaced with full @param coverage including `options._internal`). All deletions are inside JSDoc blocks.

## Total public exports documented

**53 symbols** (10 function exports plus the 3 vault-gateway non-function exports = 13 in vault-gateway, plus 4+1+2+1+3+4+4+9+8+13 = 53 across all 10 files. The plan brief cited 54 — see deviation note below.)

## Framing decisions

**D-LOCK-3** per `.planning/phases/21-closeout-hygiene/21-CONTEXT.md`:
> "Public" = every symbol attached to `module.exports`. Each gets `@param`, `@returns`, one-line description.

**D-LOCK-3-AMEND-A**:
> `module.exports._testOnly` exports are explicitly excluded from the JSDoc surface (rationale documented at the export site as `// Test-only seam — not public API. JSDoc not required per Phase 21 D-LOCK-3.`).

**Lock 5 (file-type fence)**:
> `src/*.js` edits permitted in Phase 21 are JSDoc + lint-disable only. No logic changes.

## Deviations / anomalies (flagged for reviewer)

1. **`semantic-index.js` actual public export count is 8**, not 9 as recorded in CONTEXT.md and the plan brief. Verified against the live `module.exports = { ... }` literal at lines 536–558. Public exports: `indexNewEntries`, `semanticSearch`, `hybridSearch`, `selfHealIfNeeded`, `computeSchemaVersion`, `createVoyageClient`, `getEmbeddingsPath`, `getMetadataPath`. All 8 already had complete JSDoc; the only edit to this file was the `_testOnly` carve-out comment.

2. **`generateCandidateId` in `memory-proposals.js` takes zero arguments**, not three as stated in the plan brief Task 1 action. The actual function reads from disk to determine the next sequence number; documented accurately as `@returns {string}` with no `@param` lines.

3. **Total documented exports = 53 (not 54)**, due to deviation #1.

These deviations are documentation-baseline drift in CONTEXT.md/plan brief, not implementation issues. The actual code was documented per the live signature in every case.

## Live test count after Plan 21-02

```
Test Suites: 4 skipped, 51 passed, 51 of 55 total
Tests:       38 skipped, 45 todo, 1044 passed, 1127 total
Snapshots:   0 total
Time:        11.888 s
```

Same totals as Plan 21-01 baseline (this plan adds only documentation comments — no new tests).

## Files modified

| File | Lines added | Lines deleted | Notes |
|------|-------------|---------------|-------|
| `src/daily-stats.js` | 6 | 0 | @returns {void} on 6 emit functions |
| `src/memory-proposals.js` | 35 | 0 | Full JSDoc on 4 exports + carve-out |
| `src/promote-memories.js` | 11 | 0 | Full JSDoc on `promoteMemories` |
| `src/recall-command.js` | 11 | 3 | Extended `runRecall` JSDoc |
| `src/semantic-index.js` | 1 | 0 | `_testOnly` carve-out comment |
| `src/today-command.js` | 23 | 7 | Expanded `runToday` options coverage |
| `src/vault-gateway.js` | 6 | 0 | @type/@class on 3 non-function exports + @returns on validateConfig and logDecision |
| **Total** | **83** | **10** | All deletions are pre-existing JSDoc lines being expanded |

3 files unchanged (already had complete JSDoc): `src/classifier.js`, `src/memory-extractor.js`, `src/memory-reader.js`.

## What this plan does NOT do

- Does NOT modify any function body (Lock 5 fence)
- Does NOT introduce new tests (no Unicode-variant assertions, no new behavior)
- Does NOT change `src/content-policy.js` (out of scope; Plan 21-01 territory)
- Does NOT update REQUIREMENTS.md, ROADMAP.md, or any of the 5 named docs (deferred to Plan 21-04)

## Next step

Plan 21-02 awaits commit + PR per Connor's standard ship pattern. After this PR merges, Plan 21-03 (HYG-CONSOLE-01 — 32-row categorization manifest + 32 eslint-disable directives) is next in Wave 3. Plan 21-04 (DOCS-FINAL-01) waits on 21-01/02/03 per its `depends_on`.
