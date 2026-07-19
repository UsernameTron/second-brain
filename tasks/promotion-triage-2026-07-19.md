# Memory promotion triage — 2026-07-19

> ## ⚠ CORRECTION — 2026-07-19 evening: the central finding below is FALSE
>
> The "3 stranded / restore" recommendation is **wrong**. All 12 entries archived by
> the 15:37 reorg — including the three called "unique, no live twin" — carry
> `superseded_by::` pointers resolving to **live, richer** entries in `memory.md`.
> Verified against disk, hash by hash, 2026-07-19 evening:
>
> | Archived (`memory-archive/2026-07.md`) | Live superseder (`memory.md`) |
> |---|---|
> | `bf04e30facf4` (zero-suites green run) | `99f9a664b51b` — richer: names `testPathIgnorePatterns` as the mechanism |
> | `cebae8bcd6a4` (Effort-1 is a hypothesis) | `7601976f95e3` — richer: explains test-contract blindness, names mocks/spies |
> | `f2d1062880b7` (zero grep hits ≠ orphan) | `977cfc40635e` — richer: carries the worked schema-glob example |
>
> **How the error happened:** the triage matched on *wording similarity* and never
> followed the `superseded_by::` pointers present in the archive entries themselves.
> **Nothing needs restoring; the "Restore" table, the merge row, and human-call #2
> below are void.** Original text retained below for the record. The archive's
> recall-invisibility remains a true design fact; the integrity guard is
> `scripts/validate-archive.js` (added alongside this correction).

Prepared for the operator's `/promote-memories` review pass. **No dispositions were
changed and nothing was promoted** — per the accepted CONSTRAINT `mem-20260719-133`,
checkbox/disposition state in a human-approval queue stays open for a human.

---

## Headline: there is no promotion queue

The briefed premise was "54 accepted candidates awaiting a human `/promote-memories`
pass." That is not the live state. **All 54 are already promoted and terminal.**

Evidence:

| Check | Result |
|---|---|
| `status:: accepted` blocks in `proposals/memory-proposals.md` | 54 |
| `total_pending` in the proposals frontmatter | **0** |
| `LIVE_STATUSES` in `src/promote-memories.js:26` | `{pending, deferred}` — `accepted` is **not** live |
| Gate at `src/promote-memories.js:445` | `if (!LIVE_STATUSES.has(c.currentStatus)) return false;` |
| Of the 54, `content_hash` found in `memory/memory.md` | 45 |
| Of the 54, `content_hash` found in `memory-archive/2026-07.md` | 9 |
| Unaccounted for | **0** |

`accepted` is the terminal status the promoter itself writes after a successful
promotion (`replacements[c.candidateId] = 'accepted'`, line ~509). Running
`/promote-memories` now would promote nothing — correctly. The review pass this
document was meant to accelerate is already done.

**So the real decisions are not "promote or not."** They are the two follow-on
conditions the promotion left behind, below.

---

## Decision 1 — 12 entries are stranded in the archive, invisible to `/recall`

The manual reorg at 2026-07-19 15:37 (`memory/memory.md.pre-reorg.20260719T203714Z`)
moved 12 entries out of `memory.md` into `memory-archive/2026-07.md`. Nine of them
are from this batch of 54.

**`memory-archive/` is not read by retrieval.** Only `promote-memories.js` (dedup),
`memory-proposals.js`, and a `classifier.js` path label reference it. Neither
`src/memory-reader.js` nor `src/recall-command.js` touches it:

```
$ grep -rn "memory-archive" src/
src/promote-memories.js:20   ARCHIVE_DIR   (dedup only)
src/memory-proposals.js:25   ARCHIVE_DIR
src/classifier.js:235        'memory-archive': 'Archived memory entries from previous years'
```

Two consequences worth a human call:

1. **Archiving is a soft delete from recall.** An archived memory still blocks its own
   re-promotion (`isDuplicateInMemory` reads the archive) but can never be retrieved.
   That combination means an archived entry is unreachable *and* unrecoverable through
   the normal pipeline.
2. **`classifier.js:235` documents the archive as "entries from previous years."**
   The reorg archived *current-month* (2026-07) entries. On-disk state contradicts the
   documented contract. This is the contradiction flagged for human decision.

Six of the nine are near-duplicates whose better twin is live in `memory.md` — those
are fine where they are. Three are unique and lose real content by being archived.

### ~~Restore to `memory.md` (unique, no live twin) — 3~~ *(VOID per correction above — all three have live, richer superseders)*

| # | ID | Hash | One line |
|---|---|---|---|
| 38 | `mem-20260719-124` | `cebae8bcd6a4` | An audit's "Effort-1 Quick Win" rating is a hypothesis — it never ran the tests; treat behavior-changing findings as ≥Effort-2 regardless of diff size. |
| 39 | `mem-20260719-125` | `f2d1062880b7` | Before deleting an "orphan" found by literal-name grep, check for dynamic consumers (dir scans, registry lookups, filename conventions). Zero grep hits ≠ orphan. |
| 44 | `mem-20260719-130` | `bf04e30facf4` | A test run from a non-canonical checkout (e.g. `.claude/worktrees/`) that collects **zero** suites exits green — a config artifact masking real failures. |

### ~~Merge one detail up, then leave archived — 1~~ *(VOID per correction above)*

| # | ID | Hash | One line | Merge into |
|---|---|---|---|---|
| 45 | `mem-20260719-131` | `a21a48cb3e66` | "Merged" vs "deployed" is invisible in git; a deploy reporting success may change nothing. | `mem-20260719-112` (`e88f6e004249`, live). The live twin covers the principle; the archived one adds the concrete failure modes — `firebase deploy --only` silently skipping an unchanged file, and a function deploying but staying headless. Worth carrying up. |

### Leave archived — superseded by a richer live twin — 5

| # | ID | Hash | Live twin that supersedes it |
|---|---|---|---|
| 7 | `mem-20260719-007` | `58d374fb12b4` | `mem-20260719-138` (`e9a321ce053a`) — same curl `-X POST` + `-L` → 405 finding |
| 30 | `mem-20260719-116` | `f78407989941` | `mem-20260719-139` (`6b231fca2273`) — same "fix the condition, not the named files" |
| 42 | `mem-20260719-128` | `8eb2d0e7fa7d` | `mem-20260719-113` (`026e6527c17b`) + `-135` (`525de9a9b1ca`) — both richer on the `gh` credential-helper pin |
| 48 | `mem-20260719-134` | `c758edb44299` | `mem-20260719-115` (`562054375fc4`) — same interrupted-fan-out / branch-with-no-PR signature |
| 50 | `mem-20260719-136` | `1e6ff5451547` | `mem-20260719-114` (`90829d274155`) — same zsh `set -- $x` non-splitting, with the 20-`gh pr merge` worked example |

### Also archived, not from this batch — 3

`11a67a5303da`, `f5d9a406a9ea`, `7acc1f2f8904` (all `file:weekly-digest-2026-07-17`).
`11a67a5303da` is a reworded twin of the live `mem-20260719-107` (`a5b3c450972a`,
HubSpot enrichment gap map) — correctly archived. The other two were not reviewed
here; they predate this batch.

---

## Decision 2 — the near-duplicate pairs are a capture-side signal

Six of nine archived entries in this batch are near-duplicates of live entries. Both
halves of each pair were captured, both were accepted, both were promoted, and the
reorg later cleaned up by hand. Content-hash dedup cannot catch these — the wordings
differ, so the hashes differ.

The pairs came from two different extraction sources on the same day
(`file:lessons` vs `session:CTG-Work` / `file:pattern-context`) describing the same
event. That is the mechanism worth a decision: whether v1.8 Phase 34's planned
contradiction check (hybrid top-5, flag-only) should also flag *near-duplicates*, not
just contradictions. Not a change to make here.

---

## Triage counts

Recast against actual state, since nothing is promotable:

| Recommendation | Count |
|---|---|
| Already promoted and live in `memory.md` — no action | 45 |
| RESTORE from archive (unique content, recall-invisible) | 3 |
| MERGE one detail into a live twin, then leave archived | 1 |
| DROP / leave archived (superseded by richer live twin) | 5 |
| **Total from the 54** | **54** |
| PROMOTE (nothing is in a promotable state) | **0** |
| Needs a human call | **2** (the two below) |

**Needs a human call:**

1. **Archive semantics.** `memory-archive/` is unreadable by `/recall` but *is* read
   for dedup — archiving is a soft delete with no path back. And
   `classifier.js:235` calls the archive "previous years" while `2026-07.md` holds
   current-month entries. Either retrieval should read the archive, or the reorg
   should not archive current-month entries. On-disk state and documented contract
   currently disagree.
2. ~~**Whether to restore the 3 unique entries** (rows 38 / 39 / 44 above).~~ *(VOID per correction above — each has a live, richer superseder; nothing is unrecallable.)*

---

## Unrelated finding logged while here

`com.secondbrain.daily-sweep` has never fired. Root cause: `ProgramArguments[0]` was
bare `node`, and launchd's default `PATH` is `/usr/bin:/bin:/usr/sbin:/sbin` — node
lives at `/opt/homebrew/opt/node@22/bin/node`, so the spawn could never resolve.
`launchctl print` showed `runs = 0`, `last exit code = (never exited)`, and no log
file was ever created. Plist patched in place (absolute node path,
`WorkingDirectory`, `PATH`); `plutil -lint` OK and the script runs clean under a
launchd-equivalent stripped environment. Reload is an operator step — see the
handoff. Versioning the plist into the repo remains Phase 33 scope.
