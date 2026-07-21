---
phase: 34-promotion-integrity-lifecycle
plan: 05
subsystem: memory-pipeline
tags: [dream-consolidation, cosine-similarity, sonnet, contradiction-check, ajv-schema]

# Dependency graph
requires:
  - phase: 34-01
    provides: shared checkbox parser (parseCheckboxState in memory-proposals.js)
  - phase: 34-02
    provides: superseded-by/stale downranking in memory-reader.js
  - phase: 34-04
    provides: shared checkContradiction helper (src/contradiction-check.js)
provides:
  - dream config block + schema in config/pipeline.json / config/schema/pipeline.schema.json
  - src/dream.js: detectMergePairs, authorMerge (mechanical quote guard), detectStale
affects: [34-06, 34-07 (dream-apply, MERGE superseded-by application)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mechanical anti-hallucination guard: LLM-authored quotes verified as literal .includes() substrings of source content before a proposal is ever surfaced — no LLM self-report trusted"
    - "Bounded LLM confirm budget: deterministic (zero-token) criteria run first over all entries; LLM confirms only over a capped, prioritized subset, with a mutable budget counter shared across future dream ops"

key-files:
  created:
    - src/dream.js
    - test/dream.test.js
    - .planning/milestones/v1.8-phases/34-promotion-integrity-lifecycle/34-05-SUMMARY.md
  modified:
    - config/pipeline.json
    - config/schema/pipeline.schema.json

key-decisions:
  - "Ephemeral-category whitelist for the STALE age criterion is derived at runtime from config/memory-categories.json minus {CONSTRAINT, PREFERENCE}, rather than adding a new config field — memory-categories.json was out of this plan's files_modified scope and the exclusion set is exactly what the design doc names."
  - "readAllEmbeddings/_cosine are not part of semantic-index.js's public API (only exposed via _testOnly). Reused the already-exported _testOnly.readAllEmbeddings() via caller wiring (deferred to the future dream CLI script) and reimplemented cosine as a private one-line function in dream.js per the plan's explicit interface note, avoiding a semantic-index.js edit outside this plan's scope."
  - "detectStale's contradiction-confirm candidate ordering is ephemeral-category-first, then newest-first — not an ephemeral-only filter — since the design doc scopes the age criterion (not the contradiction criterion) to ephemeral categories."

requirements-completed: [DREAM-CONSOLIDATION-01]

# Metrics
duration: ~45min
completed: 2026-07-20
---

# Phase 34 Plan 05: Dream Consolidation Detection Layer Summary

**MERGE and STALE proposal-generating detection for dream-consolidation: pairwise-cosine + Sonnet-authored merges with a mechanical anti-hallucination quote guard, and budget-capped STALE flagging that reuses the shared contradiction helper — zero applied edits, proposal objects only.**

## Performance

- **Duration:** ~45 min (including a schema-edit hold for protected-file-guard review)
- **Tasks:** 3/3 completed
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- Locked `dream` config block (`mergeCosineMin` 0.90, `maxStaleFlags` 10, `maxLLMCalls` 40, etc.) landed in `config/pipeline.json`, schema-validated
- `detectMergePairs` + `authorMerge`: cosine-threshold pairing with same-category shortRef-prefix union, capped at `maxMergeOps`, and a mechanical `.includes()` quote guard that drops (never proposes) any pair where the Sonnet-authored quote isn't a literal substring of its source
- `detectStale`: dead-reference and ephemeral-only age criteria run first (zero tokens) over all live entries, then a bounded, budget-tracked subset goes through the reused `checkContradiction` helper — confirmed by test to never exceed `maxStaleFlags` calls even over 50 live entries
- 16 new tests, all passing; `npm run lint` clean; AJV schema validation clean

## Task Commits

Each task was committed atomically:

1. **Task 1: dream config block + schema + AJV validation** - `f3684d3` (feat) — config/schema edit applied by team-lead per protected-file-guard manual-review requirement (see Deviations)
2. **Task 2: MERGE detection + Sonnet authoring + mechanical quote verification** - `9a4410d` (feat)
3. **Task 3: STALE detection (contradiction + dead-reference + age)** - `51bdc65` (feat)

_No separate plan-metadata commit — this SUMMARY.md commit closes out the plan._

## Files Created/Modified
- `src/dream.js` - `detectMergePairs`, `authorMerge`, `detectStale`; local `_cosine`, dead-reference/age helpers
- `test/dream.test.js` - 16 tests covering pairing, quote-guard drop, dead-reference, age-protection, contradiction flagging, and the 50-entry confirm-cap-holds case
- `config/pipeline.json` - added the locked `dream` block
- `config/schema/pipeline.schema.json` - added `dream` to top-level `required` + its object schema (9 required keys, `additionalProperties: false`)

## Decisions Made
See `key-decisions` in frontmatter. In short: ephemeral-category whitelist derived from `memory-categories.json` at runtime (no new config field); cosine reimplemented locally per the plan's own interface note rather than exporting `semantic-index.js` internals out of scope; STALE's LLM-confirm ordering prioritizes ephemeral categories without excluding non-ephemeral entries from contradiction checks (only the age criterion is ephemeral-only, per design doc).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Protected-file-guard blocked the schema edit; escalated instead of working around it**
- **Found during:** Task 1 (dream config block + schema)
- **Issue:** `.claude/hooks/protected-file-guard.sh` hard-blocks all Edit/Write to `config/schema/**` with no bypass flag. This is a repo policy gate, not a task-scoped blocker I have authority to route around.
- **Fix:** Sent the exact schema diff to team-lead via SendMessage and paused Task 1's schema portion; `config/pipeline.json`'s `dream` block was applied immediately (not under the guard). Team-lead applied the schema edit directly and committed it as `f3684d3` ("operator-applied via protected-schema manual review"). Confirmed AJV validation green before proceeding.
- **Files modified:** config/schema/pipeline.schema.json (by team-lead, not this agent)
- **Verification:** `node -e "...AJV compile+validate..."` → `valid: true`; pre-commit schema-validate hook passed on subsequent commits.
- **Committed in:** f3684d3

---

**Total deviations:** 1 (Rule 3 — blocking, routed through team-lead per protected-file policy, not auto-fixed by this agent)
**Impact on plan:** No scope creep; the schema content matches the plan's locked interface exactly. This agent did not edit config/schema/pipeline.schema.json directly — team-lead applied it under manual review, as the guard requires.

## Issues Encountered
A background Stop-hook auto-commit (`faeae33`, unrelated session housekeeping) landed between tool calls and briefly complicated `git diff`/`git add` bookkeeping (files appeared staged that this agent hadn't explicitly added). Resolved by inspecting `git show --stat` per commit and re-verifying each task's diff was scoped correctly before and after — no incorrect content was committed.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `src/dream.js` MERGE/STALE detection is ready for the future `/dream-propose` CLI (Plan 34-06+) to wire in: load `config/pipeline.json`, `readMemory()`, `readAllEmbeddings()` (via `semantic-index.js`'s `_testOnly` seam or a future public export), call `detectMergePairs` → `authorMerge` per pair, and `detectStale`, then write the `proposals/dream-changeset-YYYY-MM.md` changeset format from the design doc.
- MISSED PATTERNS (the third dream op) and the apply-side (`/dream-apply`, snapshot-first sequence) remain out of scope for this plan, per DREAM-CONSOLIDATION-01's scope boundary (Plan 34-07+).
- `readAllEmbeddings`/`_cosine` in `semantic-index.js` remain `_testOnly` — a future plan wiring the CLI entry point should decide whether to promote `readAllEmbeddings` to the public export list rather than reaching into `_testOnly` from production code.

---
*Phase: 34-promotion-integrity-lifecycle*
*Completed: 2026-07-20*

## Self-Check: PASSED

- FOUND: src/dream.js
- FOUND: test/dream.test.js
- FOUND: .planning/milestones/v1.8-phases/34-promotion-integrity-lifecycle/34-05-SUMMARY.md
- FOUND commit: f3684d3
- FOUND commit: 9a4410d
- FOUND commit: 51bdc65
