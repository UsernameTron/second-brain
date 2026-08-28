# Quick Task 260827-oxq: Recall `--since` arm parity + memory.md anchor/stale fixes

**Date:** 2026-08-27
**Branch:** `worktree-fix+recall-since-arm-parity`
**Origin:** 2026-08-27 adversarial-fork critic verdict on `~/Claude Cowork/memory/memory.md` (BLOCK — 5 blockers, 3 should-fix)

## Deviation from standard quick flow

Executed inline rather than via `gsd-planner` + `gsd-executor`.

- The task spec arrived with file, line, exact replacement code, test shape, and gates — a planner would have re-derived an existing plan.
- `gsd-executor` cannot self-verify here: jest's `testPathIgnorePatterns` includes `.claude/worktrees`, so in a worktree it finds 143 test files and matches 0. Confirmed this run. Worked around with `npx jest --testPathIgnorePatterns=/node_modules/ --testPathIgnorePatterns=/agent-canvas/` plus a `node_modules` symlink to the parent checkout.

## 1. Root cause

The two recall arms filtered `--since` on different fields.

| Arm | Site | Field compared |
|---|---|---|
| keyword | `src/memory-reader.js:275` | `r.date` — the entry's heading date |
| semantic | `src/semantic-index.js:491` | `r.addedAt` — the sidecar's full ISO stamp, raw string compare |

`added::` is written in local offset. The entire 2026-08-22 promotion batch (200 entries) is stamped `2026-08-21T23:0x:xx-05:00`, which string-sorts below `"2026-08-22"`. All 200 were invisible to `--semantic`, and `--hybrid` fused a full keyword list with an empty semantic one — silently, no warning.

Reproduced before the fix:

```
node scripts/recall.js "deploy" --since 2026-08-22             -> 3 hits
node scripts/recall.js "deploy" --semantic --since 2026-08-22  -> No results
```

## 2. Change

`src/semantic-index.js` — filter on the entry's heading date via `byHash` (already in scope), falling back to the `addedAt` date prefix when a sidecar record has no matching entry.

## 3. Tests

`test/semantic-index.test.js` — two tests behind a shared `searchWithSince()` helper:

- **arm parity regression** — entry headed `2026-08-22`, stamped `2026-08-21T23:05:00-05:00`, `--since 2026-08-22` must return it. Fails on pre-fix source, passes after.
- **cutoff guard** — entry headed `2026-08-20` must still be excluded by `--since 2026-08-22`. Passes both before and after; exists so deleting the filter outright cannot make the suite green.

Negative check done properly: `git checkout HEAD~1 -- src/semantic-index.js` (guaranteed-valid pre-fix source), run, restore. Exactly 1 of the 4 `-t "since"` tests fails pre-fix — the parity one. An earlier hand-patched revert was discarded as unsound; it broke the module, so its "4 failed" proved nothing.

## 4. Gates

| Gate | Result |
|---|---|
| Full jest suite (`CI=true`) | 1540 passed / 38 skipped / **1578 total** (was 1576 — +2 new) |
| `recall.js "deploy" --semantic --since 2026-08-22` | returns hits (was `No results`) |
| `recall.js "deploy" --since 2026-08-22` (keyword) | still 3 — unchanged |
| `recall.js "deploy" --hybrid --since 2026-08-22` | 3 fused results |
| `npm run verify:baseline` | 27/27, before and after the vault edits |
| `npm run lint` | clean |
| `npm run eval:recall` | **NOT SATISFIED — pre-existing hang, see below** |

### `eval:recall` could not be run

`node scripts/eval-recall.js` hangs and is killed by timeout — `exit=124`, **0 bytes on both stdout and stderr**, at 150s and at 540s. It never reaches the per-question table or the baseline comparison it always prints before exiting.

Two earlier "exit code 0" notifications for this gate were the **harness wrapper's** exit, not the script's. That was misread as a pass and is corrected here.

Not caused by this change, on two independent grounds:

1. `scripts/eval-recall.js` never passes `since` to any search call — the only `since` in the file is a log string at :282. The changed line is unreachable from it.
2. Control run with `git checkout HEAD~1 -- src/semantic-index.js` (genuine pre-fix source) hangs identically: `exit=124`, 0 bytes.

Pre-existing defect, filed not fixed as **[#240](https://github.com/UsernameTron/second-brain/issues/240)**. Most likely a Voyage embed call on the seed vault with no timeout, but that is unverified — the script emits nothing to diagnose from, which is itself the first thing to fix.

## 5. Vault store edits — `~/Claude Cowork/memory/memory.md`

Not git-managed. Snapshotted first to `memory/.snapshots/pre-critic-fix-20260827/memory.md`.

Applied by `fix_memory.py` (job tmp, not durable), which asserts its invariants before writing.

**Precondition checked first:** `computeHash` (`src/utils/memory-utils.js:21`) hashes the entry **body only** (trim + lowercase). Confirmed empirically — all 7 target hashes recompute from `e.content` alone. So field lines are free, and the direct `stale::` route applies rather than `dream:propose` → `dream:apply`.

**4 missing `^anchor` lines** appended after `content_hash::` for the dream-merge outputs written without one: `a2b447b5cb69`, `5e1208a428e4`, `10337f62f6fd`, `6d4cc383b555`.

**7 `stale:: 2026-08-27 · <verified reason>` flags** — format and placement match `src/dream.js` `_appendFieldToEntry` (immediately after `content_hash::`, before the anchor):

| Hash | Falsified by |
|---|---|
| `4ae8adad7fff` | HEAD f459178 not 92fb427; tree clean; revision 00071-p26; deploy.sh already additive w/ preflight |
| `3a26812ba1b2` | scheduler `agent-canvas-standing-rules` ENABLED, userUpdateTime 2026-08-19 |
| `f385ebe4b6ec` | same scheduler authorization |
| `d969e2e53fe9` | `ctg-ops-prod` billingEnabled True; service Ready |
| `841d4ed9c68f` | P5 deployed + ticking since 2026-08-19; TICK vars on serving revision |
| `7f41302d67ab` | 11 `*.test.jsx` files exist; `test:frontend` wired |
| `31387d027fde` | config pins `qwen/qwen3.6-27b`; no ADR-017 exists |

**Verified after:** 525 entries / 525 `content_hash` / **525 anchors** (was 521) · dangling wikilinks **0** (was 1) · unresolved `superseded-by` pointers **0** (was 8) · `stale::` parsed by `readMemory()` on all 7 · diff vs snapshot is 11 added lines, 0 removed · `verify:baseline` 27/27.

## 6. Explicitly not done

- `src/dream.js` writer gaps — the merge path emits no `^anchor`, `added::`, or `source-ref::`. Left for the v1.8 memory-provenance-backfill milestone per instruction, filed as **[#241](https://github.com/UsernameTron/second-brain/issues/241)**. **Until it is fixed, every future dream merge reintroduces the anchorless-entry defect this task just cleaned up.**
- Recall output does not display the `stale`/`superseded` marker to the reader (critic SHOULD-FIX 3). Flagging makes the 0.4 downrank apply; it does not label the entry on screen. Out of scope here.
- Remaining critic findings untouched: the ~15 undated present-tense entries, the 19 dream-merge outputs missing `source-ref::`, and the reach-exporter egress gate dropping the entry that states the exclusion policy.
