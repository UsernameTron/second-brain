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

## What this run actually proves

The merged code passes every executable gate this repo owns: lint, the full Jest suite under CI
skip-logic, the coverage thresholds, the 27-hash memory baseline, config-schema validation, and
the LEFT/RIGHT vault-boundary check. The three warnings are staleness and housekeeping, not
defects — none of them describe behavior that is wrong on master today.

Not proven here: the two new launchd jobs have never fired on this machine. `com.secondbrain.promote`
(00:45) and `com.secondbrain.pulse` (Monday 07:00) are versioned and now in the deploy checklist,
but installing and bootstrapping them is a manual step, and neither has produced a real run yet.
First real evidence will be the 00:45 log and Monday's brief.
