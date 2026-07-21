---
name: dream-apply
description: |
  Human-invoked-only apply pass for the vault's compounding memory store at
  memory/memory.md (NOT Claude Code's own MEMORY.md auto-memory files — see
  the separate dream-memory-consolidation skill for that store). Applies the
  accepted MERGE/STALE ops from proposals/dream-changeset-YYYY-MM.md
  (produced by /dream-propose) in place: snapshots memory.md + embeddings
  sidecar + SQLite index first, MERGE inserts the merged entry and
  supersedes (never deletes) both sources, STALE appends a flag line, then
  gates on a live-vault retrievability check — every merged entry must
  still be retrievable via hybrid search, or a regression (or blocked/
  degraded retrieval, which fails closed) auto-restores the snapshot and
  reverts the applied ops to unresolved. Never scheduled; never runs
  unattended.

  TRIGGERS: "/dream-apply", "dream apply", "apply dream changeset",
  "apply memory merges", "consolidate memory now"
---

# /dream-apply

## QUICK START

Run `node scripts/dream.js --apply` (or `npm run dream:apply`) from the
repo root, human-invoked only — never scheduled. It:

1. Finds the newest `proposals/dream-changeset-YYYY-MM.md` written by
   `/dream-propose`. Nothing to apply → exits cleanly.
2. Acquires the proposals `.lock` (same lock file `/promote-memories` and
   `/wrap` use) so a concurrent write can't race the apply.
3. **Snapshots first:** copies `memory/memory.md`, the embeddings sidecar,
   and `index.db` to `memory/.snapshots/dream-YYYYMMDD/` before touching
   anything.
4. Applies every op whose `accept` box is checked and that isn't already
   marked `applied::` (no double-apply), capped at
   `config.promotion.batchCapMax` (5-10):
   - **MERGE** inserts the merged entry into the current `## YYYY-MM`
     section and appends `superseded-by:: <newhash>` to BOTH sources —
     sources are never deleted.
   - **STALE** appends its flag line (`stale::` or `superseded-by::`) to
     the target entry — the target is never deleted.
5. Regenerates the auto-index, embeds new merged-entry hashes (old
   embeddings are kept), rebuilds the SQLite index, and re-runs the reach
   export.
6. **Mandatory gate:** a live-vault retrievability check — every merged
   entry must still be retrievable from the mutated vault via hybrid
   search. A regression (or blocked/degraded retrieval, which fails
   closed) auto-restores the snapshot byte-for-byte and reverts the
   applied ops' accept boxes to unresolved — nothing regressed stays
   applied. A clean pass stamps each applied op `applied:: <timestamp>` and
   updates `state/dream-ledger.json`.

## WHEN TO USE

- After reviewing a `/dream-propose` changeset and checking `accept` on the
  ops you want applied — manually, whenever you're ready, not on a timer.

## SCHEDULE

Never. `/dream-apply` (`scripts/dream.js --apply`) does not appear in
`config/com.secondbrain.dream.plist` or any launchd/`config/scheduling.json`
entry — it is a deliberate human action every time, backstopped by the
live-vault retrievability gate's auto-restore.

## REFUSES

Editing `memory/memory.md` without a prior snapshot, deleting any source or
target entry, applying more than `batchCapMax` ops per invocation,
re-applying an op already marked `applied::`, and keeping a recall
regression applied (auto-restores instead).
