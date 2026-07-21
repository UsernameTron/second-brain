---
phase: 34-promotion-integrity-lifecycle
plan: 07
subsystem: memory-pipeline
tags: [dream-consolidation, dream-apply, snapshot-restore, eval-gate, skill]

# Dependency graph
requires:
  - phase: 34-06
    provides: src/dream.js parseChangesetOps/hasUnresolvedChangeset (shared-parser-gated changeset), scripts/dream.js --propose entrypoint, state/dream-ledger.json shape
provides:
  - src/dream.js snapshotStore/applyOps/restoreSnapshot/runEvalGate/acquireProposalsLock/releaseProposalsLock/findLatestChangesetPath
  - scripts/dream.js --apply (full snapshot -> apply -> reindex -> eval-gate -> restore-on-fail sequence)
  - .claude/skills/dream-apply/SKILL.md, npm run dream:apply
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Proposals lock is guarded by taking the SAME lock file memory-proposals.js uses (VAULT_ROOT/proposals/memory-proposals.md.lock), not by importing its acquireLock/releaseLock — those stayed privatized to _testOnly (Phase 15 decision). dream.js implements its own tiny acquire/release against the same path so concurrent wrap/promote writes are still blocked."
    - "Apply idempotency: an accepted op's checkbox alone doesn't mean 'not yet applied' — applyOps skips any op section already carrying an `applied::` marker line, and runEvalGate stamps that marker on a clean eval pass. A second /dream-apply run against the same changeset is a safe no-op for already-applied ops."
    - "MERGE/STALE field mutation is marker-anchored, not line-numbered: _appendFieldToEntry finds `content_hash:: <hash>` and inserts the new field line immediately after it, so superseded-by::/stale:: land inside the correct entry's own field block regardless of where else in the file that hash string might otherwise appear."

key-files:
  created:
    - test/dream-apply.test.js
    - .claude/skills/dream-apply/SKILL.md
  modified:
    - src/dream.js
    - src/promote-memories.js
    - scripts/dream.js
    - package.json

key-decisions:
  - "Promoted promote-memories.js's regenerateAutoIndex from internal-only to a real module export (one line, zero behavior change) — same additive-export pattern 34-06 used for semantic-index.js's readAllEmbeddings. applyOps needed it and promote-memories.js was not in this plan's listed files, but it was a blocking missing-export (Rule 3), not a design change."
  - "Chose NOT to promote memory-proposals.js's acquireLock/releaseLock out of _testOnly (that privatization was a deliberate Phase 15 decision, and touching it wasn't in this plan's file list). Instead dream.js takes the SAME lock file path via its own small acquireProposalsLock/releaseProposalsLock pair — satisfies 'guards concurrent wrap/promote writes' without reopening a closed module-boundary decision."
  - "Ops are marked applied via an `applied:: <ISO>` line stamped right after each op's header on a clean eval pass, rather than a separate ledger-keyed applied-ops list — keeps the changeset file itself as the single source of truth for 'was this specific op already applied', readable by a human re-opening the file."
  - "runEvalGate takes a runEvalFn dependency-injection seam (throws == exit 1, returns == exit 0) instead of shelling out unconditionally, so the apply<->eval-fail<->restore round trip is testable without ever invoking the real eval harness (which needs VOYAGE_API_KEY + a live seed-vault run) from src/dream.js's own test suite."

requirements-completed: [DREAM-CONSOLIDATION-01]

# Metrics
duration: ~55min
completed: 2026-07-20
---

# Phase 34 Plan 07: Dream-Consolidation Apply Path Summary

**The only path that mutates memory.md — snapshot-first, MERGE/STALE apply-in-place with sources superseded-not-deleted, and a mandatory `npm run eval:recall` gate that auto-restores byte-identically on a recall regression.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3/3 completed
- **Files modified:** 6 (2 created: test/dream-apply.test.js, .claude/skills/dream-apply/SKILL.md; 4 modified: src/dream.js, src/promote-memories.js, scripts/dream.js, package.json)

## Accomplishments
- `snapshotStore`/`restoreSnapshot`: copy memory.md + embeddings.jsonl + index.db to `memory/.snapshots/dream-YYYYMMDD/` before any apply edit; restore is byte-identical (tested).
- `applyOps`: selects accepted, not-yet-applied ops via the shared `parseCheckboxState` (through `parseChangesetOps`), caps at `config.promotion.batchCapMax`. MERGE inserts the merged entry into the current `## YYYY-MM` section and appends `superseded-by:: <newhash>` to BOTH sources (verified: sources' original text stays verbatim in the file). STALE appends its flag line to the target (also never deleted). Regenerates the auto-index and embeds new merged-entry hashes via `indexNewEntries` (old embeddings kept).
- `runEvalGate`: runs the mandatory eval gate via an injectable `runEvalFn` seam. Exit 1 (recall regression) calls `restoreSnapshot` and reverts the applied ops' accept boxes to unresolved in the changeset file. Exit 0 stamps each applied op `applied:: <ISO timestamp>` so a later apply run skips it (no double-apply).
- `scripts/dream.js --apply`: resolves the newest `proposals/dream-changeset-*.md`, acquires the proposals lock (same lock file `/promote-memories`/`/wrap` use), runs `snapshotStore -> applyOps -> SQLite rebuild --strict + reach export (non-fatal) -> runEvalGate -> ledger update`, releases the lock in a `finally`. `npm run dream:apply` added.
- `.claude/skills/dream-apply/SKILL.md`: documents the vault-store target, human-invoked-only contract, and the snapshot/apply/eval-gate/restore sequence — confirmed absent from `config/scheduling.json` and any launchd plist.
- 6 new tests in `test/dream-apply.test.js`, all passing; `npm run lint` clean (0 errors).

## Task Commits

1. **Task 1 + Task 2 (combined): Snapshot + in-place apply + eval gate with auto-restore** - `9c0555e` (feat)
2. **Task 3: scripts/dream.js --apply wiring + /dream-apply skill** - `0584588` (feat)

## Files Created/Modified
- `src/dream.js` - `snapshotStore`, `restoreSnapshot`, `applyOps`, `runEvalGate`, `acquireProposalsLock`, `releaseProposalsLock`, `findLatestChangesetPath`, plus private helpers `_indexDbPath`, `_appendFieldToEntry`, `_parseMergeOp`, `_parseStaleOp`, `_revertOpsToUnresolved`, `_markOpsApplied`
- `src/promote-memories.js` - `regenerateAutoIndex` added to module.exports (was internal-only)
- `scripts/dream.js` - `runApply()`, wired into the `--apply` CLI branch; module.exports gained `runApply`
- `package.json` - added `"dream:apply": "node scripts/dream.js --apply"`
- `test/dream-apply.test.js` - new: applyOps (MERGE supersede, STALE flag, applied:: skip), snapshotStore/restoreSnapshot round trip, runEvalGate (eval-fail restore, eval-pass mark-applied)
- `.claude/skills/dream-apply/SKILL.md` - new: `/dream-apply` skill

## Decisions Made
See `key-decisions` in frontmatter. In short: `regenerateAutoIndex` promoted to a real export (small, surgical, matches 34-06's own precedent); proposals locking reuses the same lock FILE rather than importing memory-proposals.js's privatized lock code; applied-state lives as an `applied::` marker inside the changeset itself; `runEvalGate` is dependency-injectable so the eval-fail/restore round trip is unit-testable without a live eval run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `regenerateAutoIndex` was not exported from `src/promote-memories.js`**
- **Found during:** Task 1 (`applyOps` implementation)
- **Issue:** `promote-memories.js` only exported `promoteMemories`, `parsePromoteArgs`, `resolvedVaultRoot`. `applyOps` needs `regenerateAutoIndex` after inserting a merged entry, per the plan's own action text ("Call `regenerateAutoIndex()`").
- **Fix:** Added `regenerateAutoIndex` to `promote-memories.js`'s `module.exports` — one line, zero behavior change, same additive-export pattern 34-06 used for `semantic-index.js`'s `readAllEmbeddings`.
- **Files modified:** `src/promote-memories.js`
- **Commit:** `9c0555e`

**2. [Process, not functional] Tasks 1 and 2 landed in a single commit**
- **Found during:** Task 1/2 implementation
- **Issue:** `snapshotStore`/`applyOps`/`restoreSnapshot` (Task 1) and `runEvalGate` (Task 2) were written as one coherent editing pass in `src/dream.js` — the eval-gate logic depends directly on `restoreSnapshot` and shares the changeset-mutation helpers (`_revertOpsToUnresolved`/`_markOpsApplied`) with `applyOps`'s output shape, and unlike 34-06's precedent this interleaving wasn't cleanly separable into two independent diffs after the fact.
- **Resolution:** Committed together as `9c0555e` rather than reconstructing an artificial split. Both tasks' acceptance criteria (grep checks, `-t "supersede"`, `-t "restore"`, `-t "eval-fail"`) all pass against that single commit.

## Issues Encountered
None beyond the two deviations above. `npx jest --silent` across the full suite shows one pre-existing, unrelated failure (`test/config-validator.test.js` — a `memory.semantic` schema-integration test that was already failing before this plan's changes, confirmed via a clean checkout of the same test) — not touched, out of this plan's scope.

## User Setup Required
None. `/dream-apply` is available immediately via `npm run dream:apply` or `node scripts/dream.js --apply` once a `proposals/dream-changeset-YYYY-MM.md` exists with at least one accepted op (produced by `/dream-propose` + human review).

## Next Phase Readiness
Phase 34 (promotion-integrity-lifecycle) is now fully implemented: propose (34-06) and apply (34-07) both exist, tested, and the apply path is the only one able to mutate `memory/memory.md`, gated by a mandatory recall-regression backstop with automatic snapshot restore. No further plans are queued under this phase per the roadmap.

---
*Phase: 34-promotion-integrity-lifecycle*
*Completed: 2026-07-20*

## Self-Check: PASSED

- FOUND: src/dream.js (snapshotStore, applyOps, restoreSnapshot, runEvalGate, acquireProposalsLock, releaseProposalsLock, findLatestChangesetPath all grep-confirmed)
- FOUND: src/promote-memories.js (regenerateAutoIndex exported)
- FOUND: scripts/dream.js (--apply wired, runApply exported)
- FOUND: package.json (dream:apply script)
- FOUND: .claude/skills/dream-apply/SKILL.md
- FOUND: test/dream-apply.test.js (6/6 passing)
- FOUND commit: 9c0555e
- FOUND commit: 0584588
- CONFIRMED: `grep -rn "dream.js --apply" config/scheduling.json ~/Library/LaunchAgents/com.secondbrain.dream.plist` returns nothing
