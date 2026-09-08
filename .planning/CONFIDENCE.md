---
verdict: FIX-FIRST
score: n/a
generated: 2026-09-08
---
# Confidence Report

Run context: master at `41b9326` (PR #246 squash-merged), v1.8 Measured Memory in progress.

| Leg | Surface | Result | Detail |
|-----|---------|--------|--------|
| 1 | Planning health | PASS | `gsd-tools validate health` → healthy; 0 errors, 0 warnings, 0 repairable |
| 2 | Quality audits | WARN | Deps: 0 production vulns, 1 high dev-only (`fast-uri` 3.1.5 via ajv — dependabot #243 open). Licenses PASS. Agent-roster and validate-phase legs skipped (no `agents/gsd-*.md`, no `.planning/phases/`) |
| 3 | Build/test/lint | PASS | No build step (plain CJS, by design). ESLint clean. Jest CI: 1583 passing / 38 skipped / 1621 total, 0 failing. Coverage branches 80.41% (gate 80), statements 92.04%, functions 95.52%, lines 93.08%. `verify:baseline` 27/27. pre-commit schema + vault-boundary + archive-integrity gates pass |
| 4 | Codebase map | WARN | `.planning/codebase/*.md` last written 2026-08-19; `src/` and `scripts/` changed 2026-09-08. 20 days stale, 7 docs |
| 5 | Docs | PASS | Drift found and fixed in 2 files: `/pulse` had a command file but no row in the CLAUDE.md command table, and README documented neither `/pulse` nor the fact that promotion is now unattended. Stats gate (`hooks/pre-push`) reports current |
| 6 | Repo cleanliness | WARN | Untracked 0, `[gone]` branches 0, tracked files >5MB 0, orphaned `_absorbed/` 0. 1 unresolved debug file (`status: diagnosed`, not closed). 7 TODO/FIXME hits are all false positives — test fixtures and prompt strings, no real markers |

No leg FAILED. Three WARNs, none of which block correctness of what is on master.

## Ranked fixes

1. **Codebase maps 20 days stale** (leg 4) — this session changed the promotion and pulse
   surfaces; `ARCHITECTURE.md` / `STRUCTURE.md` / `TESTING.md` still describe the pre-merge tree.
   Fix: `/gsd:map-codebase` (spawns mapper subagents — not run here, subagent dispatch was off
   for this session).

2. **`fast-uri` high advisory, dev-only** (leg 2) — reached only through `ajv@8.20.0` in the dev
   tree; production audit is clean, so nothing shipped is exposed.
   Fix: merge [dependabot #243](https://github.com/UsernameTron/second-brain/pull/243).

3. **`.planning/debug/memory-pipeline-audit.md` left at `status: diagnosed`** (leg 6) — opened
   2026-07-19, confirmed a dotenv gate that made promotions embed zero vectors. The finding was
   acted on, but the file was never closed out, so the sweep keeps counting it as open work.
   Fix: confirm the fix landed, then set `status: resolved` or move it under a phase summary.

## Correction — the verdict above did not survive contact

Written before the merged code was checked against the PR's own review findings.
Doing that check found a defect every green gate missed: `skipStats` was added to
promoteMemories' options but never to `ALLOWED_OPTIONS`, so `PROMOTE-FLAGS-01`
rejected it, `promote-scheduled.js` exited 1 on round 1, and the nightly
`com.secondbrain.promote` job promoted nothing from merge until `264cd81` fixed it
in [#247](https://github.com/UsernameTron/second-brain/pull/247).

The seven promote-scheduled tests all passed because they mocked `promoteMemories`.
Lint, coverage, CodeQL, the baseline hashes and the schema gates were all green the
whole time. The headline feature of the release had never run once.

Both lessons are recorded in `tasks/lessons.md`: a mocked collaborator cannot verify
that collaborator's contract, and "every gate green" is not "the feature works" —
for an unattended job, run its real plist argv against a temp `VAULT_ROOT` and quote
the exit code.

Post-fix, verified on merged master (`264cd81`):

```
$ VAULT_ROOT=$TMP node scripts/promote-scheduled.js --drain
{"round":1,"promoted":0,"deferred":0,...}
{"done":true,"promoted":0,"rounds":1}
EXIT=0
```

## What this run actually proves

The merged code passes every executable gate this repo owns: lint, the full Jest suite under CI
skip-logic, the coverage thresholds, the 27-hash memory baseline, config-schema validation, and
the LEFT/RIGHT vault-boundary check. As the correction above shows, that is a narrower claim than
it sounds — it was true while the nightly job was exiting 1 every run. Gates bound what is
checked, not what works.

Not proven here: the two new launchd jobs have never fired on this machine. `com.secondbrain.promote`
(00:45) and `com.secondbrain.pulse` (Monday 07:00) are versioned and now in the deploy checklist,
but installing and bootstrapping them is a manual step, and neither has produced a real run yet.
First real evidence will be the 00:45 log and Monday's brief.
