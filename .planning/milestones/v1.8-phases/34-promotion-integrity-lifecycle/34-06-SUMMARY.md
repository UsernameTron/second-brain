---
phase: 34-promotion-integrity-lifecycle
plan: 06
subsystem: memory-pipeline
tags: [dream-consolidation, missed-patterns, changeset, shared-checkbox-parser, launchd, skill]

# Dependency graph
requires:
  - phase: 34-01
    provides: shared checkbox parser (parseCheckboxState in memory-proposals.js)
  - phase: 34-05
    provides: src/dream.js detectMergePairs/authorMerge/detectStale, dream config block
provides:
  - src/dream.js detectPatterns (MISSED PATTERNS extraction, two-layer dedup, stages into promote gate)
  - src/dream.js writeChangeset / parseChangesetOps / hasUnresolvedChangeset (reviewable MERGE/STALE changeset, shared-parser gated)
  - scripts/dream.js --propose / --dry-run entrypoint, state/dream-ledger.json
  - config/com.secondbrain.dream.plist (monthly, propose-only), .claude/skills/dream-propose/SKILL.md
affects: [34-07 (dream-apply: snapshot-first MERGE/STALE apply sequence consuming parseChangesetOps)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-layer dedup for cross-session pattern extraction: embedding cosine vs live entries (checked in dream.js before staging) AND content_hash vs memory/archive/proposals (delegated to writeCandidate's own dedup) — no new dedup logic duplicated in dream.js"
    - "Changeset checkbox parsing routes exclusively through memory-proposals.js's shared parseCheckboxState — dream.js has zero hand-rolled checkbox regex, satisfying the operator hard constraint"
    - "Refuse-on-pile-up gate: hasUnresolvedChangeset() treats anything other than accepted/rejected (including deferred and ambiguous) as unresolved, matching the promote gate's own defer-carries-forward semantics"

key-files:
  created:
    - scripts/dream.js
    - state/dream-ledger.json (created at runtime by --propose; not present in this plan's tree)
    - config/com.secondbrain.dream.plist
    - .claude/skills/dream-propose/SKILL.md
  modified:
    - src/dream.js
    - src/semantic-index.js
    - test/dream.test.js
    - config/scheduling.json
    - package.json

key-decisions:
  - "Promoted semantic-index.js's readAllEmbeddings from the _testOnly seam to a real module export (one line added to module.exports, zero behavior change) so dream.js reads it from production code rather than reaching into a test-only seam, per 34-05's own next-phase-readiness note."
  - "authorMerge's return object gained a sourceEntries field (the full a/b entry objects) so writeChangeset can render sources:: with date/category/shortRef without a second memory.md lookup — additive only, existing 34-05 authorMerge tests still pass unchanged."
  - "detectPatterns takes a dryRun dep: detection, chunked Sonnet calls, and cosine dedup all run identically in dry-run mode; only the final writeCandidate staging call is skipped. This matches the plan's literal 'dry-run does everything except writing' wording, verified live: --dry-run reported 15 mergeOps/5 patternAdds and wrote nothing (changeset, ledger, and proposals/memory-proposals.md file mtime all unchanged)."
  - "golden-hash:: is stamped for both MERGE and STALE ops (the design doc's general statement, not just the MERGE example shown in the interfaces excerpt) — a stale-flagged entry that happens to be a golden answer needs the same reviewer warning as a merge source."
  - "config/com.secondbrain.dream.plist is committed as the plist source but never loaded by this agent (launchctl load is an operator action per the plan's constraint); config/scheduling.json documents the install command in its existing notes.* string-valued schema shape (no schema edit — config/schema/ is hook-protected and out of this plan's scope)."

requirements-completed: [DREAM-CONSOLIDATION-01]

# Metrics
duration: ~70min
completed: 2026-07-20
---

# Phase 34 Plan 06: Dream-Consolidation Propose Path Summary

**MISSED PATTERNS extraction with cosine+hash dedup riding the existing promote gate, a shared-parser-gated MERGE/STALE changeset writer with refuse-on-pile-up, and the `scripts/dream.js --propose`/`--dry-run` entrypoint verified live against the real vault (15 merge ops, 5 pattern adds, zero side effects on dry-run).**

## Performance

- **Duration:** ~70 min (includes one live `--dry-run` run against the real 163-entry vault, ~7 min of real Sonnet/Haiku API calls)
- **Tasks:** 3/3 completed
- **Files modified:** 8 (4 created, 4 modified — plus a runtime-created `state/dream-ledger.json` that stays absent until the first real `--propose` run)

## Accomplishments
- `detectPatterns`: windows `state/session-log.md` + `state/decisions.md` by `sessionLogWindow`, ≤2 chunked Sonnet calls, confidence ≥0.75, dedups by embedding cosine (≥`patternDedupCosine`) then content_hash (via `writeCandidate`'s own dedup), caps at `maxPatternAdds`, stages zero new apply mechanics into the untouched `/promote-memories` gate
- `writeChangeset` + `parseChangesetOps` + `hasUnresolvedChangeset`: renders MERGE/STALE ops to `proposals/dream-changeset-YYYY-MM.md` in the exact design-doc format, checkbox state resolved exclusively through the shared `parseCheckboxState` (grep-confirmed zero hand-rolled checkbox regex in `src/dream.js`), refuses to run while any op is unresolved (deferred or ambiguous both count as unresolved)
- `scripts/dream.js --propose|--dry-run|--apply`: wires detection → changeset + pattern staging → `state/dream-ledger.json` under a shared `maxLLMCalls` budget; `--apply` stubs to "not yet implemented (Plan 34-07)"; verified live — `--dry-run` exited 0, reported 15 mergeOps/5 patternAdds, and left the vault's changeset dir, ledger, and `proposals/memory-proposals.md` mtime all untouched
- `config/com.secondbrain.dream.plist` (monthly, Day 1 07:15, `--propose` only, `RunAtLoad false`) and `.claude/skills/dream-propose/SKILL.md` (explicitly disambiguates from the existing `dream-memory-consolidation` skill's Claude Code MEMORY.md target)
- 27 tests in `test/dream.test.js` (11 new: 6 detectPatterns, 5 changeset/refuse-gate), all passing; `npm run lint` clean (0 errors)

## Task Commits

Each task was committed atomically:

1. **Task 1: MISSED PATTERNS extraction + anti-re-proposal dedup** - `a01e092` (feat)
2. **Task 2: Changeset writer (shared parser) + refuse-on-unresolved** - `412e5a1` (feat)
3. **Task 3: scripts/dream.js --propose entrypoint + ledger + monthly plist + /dream-propose skill** - `32785ce` (feat)

_No separate plan-metadata commit — this SUMMARY.md commit closes out the plan._

## Files Created/Modified
- `src/dream.js` - `detectPatterns`, `writeChangeset`, `parseChangesetOps`, `hasUnresolvedChangeset`; `authorMerge` gained `sourceEntries` on its return object
- `src/semantic-index.js` - `readAllEmbeddings` promoted to a real module export (was `_testOnly` only)
- `test/dream.test.js` - 11 new tests across two new `describe` blocks (`detectPatterns`, `writeChangeset + parseChangesetOps + hasUnresolvedChangeset`)
- `scripts/dream.js` - new: `--propose`/`--dry-run`/`--apply` CLI entrypoint, ledger read/write
- `config/com.secondbrain.dream.plist` - new: committed monthly propose-only launchd source
- `.claude/skills/dream-propose/SKILL.md` - new: `/dream-propose` skill, vault-store disambiguation
- `config/scheduling.json` - added `notes.dream_scheduler` (string-valued, schema-compliant) documenting the plist + install command
- `package.json` - added `"dream:propose": "node scripts/dream.js --propose"`

## Decisions Made
See `key-decisions` in frontmatter. In short: promoted `readAllEmbeddings` to a real export (small, surgical, per 34-05's own note); `authorMerge` additively gained `sourceEntries` for changeset rendering; `detectPatterns`'s `dryRun` flag skips only the final `writeCandidate` call, not detection; `golden-hash::` applies to both op types; the plist is committed but never loaded (operator action).

## Deviations from Plan

None — plan executed exactly as written. One process note: Tasks 1 and 2 were implemented in the same editing pass (both touch `src/dream.js`/`test/dream.test.js`), then deliberately split into two separate atomic commits by reconstructing each task's isolated diff from the original file — verified each intermediate state independently passed its own test subset and lint before committing, per the one-task-one-commit rule.

## Issues Encountered
`node scripts/dream.js --dry-run` against the live vault took ~7 minutes (15 MERGE authoring calls + 5 pattern-extraction candidates, each preceded by a ~10s local LM Studio fallback timeout before the real Sonnet/Haiku call succeeds) — expected behavior given `maxMergeOps: 15`, not a bug, but worth knowing for future manual runs: a real `--propose` pass will take several minutes.

## User Setup Required
**To activate the monthly schedule**, run manually (operator action, not automatable):
```bash
cp config/com.secondbrain.dream.plist ~/Library/LaunchAgents/com.secondbrain.dream.plist
launchctl load ~/Library/LaunchAgents/com.secondbrain.dream.plist
```
Until this is run, `/dream-propose` is available only via manual invocation (`npm run dream:propose` or `node scripts/dream.js --propose`).

## Next Phase Readiness
- `parseChangesetOps` and `hasUnresolvedChangeset` are the exact seam Plan 34-07 (`/dream-apply`) needs: read a changeset file, resolve per-op status via the shared parser, and gate the snapshot-first apply sequence.
- The live `--dry-run` run against the real vault left zero artifacts: `proposals/memory-proposals.md`'s mtime was unchanged before/after the run, confirming `dryRun` correctly skips the `writeCandidate` staging call for all 5 pattern-ADD candidates it detected. No cleanup needed for 34-07 testing.
- `--apply` in `scripts/dream.js` currently stubs to a stderr message + exit 1 — Plan 34-07 replaces that branch with the real snapshot → lock → apply → regenerateAutoIndex → indexNewEntries → SQLite rebuild → `eval:recall` gate sequence from DREAM-CONSOLIDATION-DESIGN.md.
- `state/dream-ledger.json` does not exist yet in this plan's tree (it is created on first real, non-dry-run `--propose` invocation) — 34-07 should read/update it via the same `loadLedger`/`saveLedger` shape documented in `scripts/dream.js`.

---
*Phase: 34-promotion-integrity-lifecycle*
*Completed: 2026-07-20*

## Self-Check: PASSED

- FOUND: src/dream.js (detectPatterns, writeChangeset, parseChangesetOps, hasUnresolvedChangeset all grep-confirmed)
- FOUND: scripts/dream.js
- FOUND: config/com.secondbrain.dream.plist
- FOUND: .claude/skills/dream-propose/SKILL.md
- FOUND: test/dream.test.js (27/27 passing)
- FOUND commit: a01e092
- FOUND commit: 412e5a1
- FOUND commit: 32785ce
