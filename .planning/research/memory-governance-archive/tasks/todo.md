# Todo

## Next
- [ ] Restart local MCP servers (Filesystem bridge timed out 2026-07-12 — Desktop Commander and Control-your-Mac likely down too)

## Phase 01 — Audit & Baseline  [ACTIVE]
- [ ] 1.1 Create `~/memory-audit/` scratch directory
- [ ] 1.2 Estate sweep — every memory-bearing file, sized and dated → `raw-estate.txt`
- [ ] 1.3 Run `dupe-check.py` → `overlap-report.txt` (the CLAUDE.md ↔ `~/context/` verdict)
- [ ] 1.4 Count skills for real; resolve the 39-vs-130 discrepancy
- [ ] 1.5 Determine whether skill-invocation telemetry exists today
- [ ] 1.6 Verify `SessionStart` / `PreCompact` / `PostToolUse` against live `/hooks`; record `claude --version`
- [ ] 1.7 Author the 20 probes — **Pete fills the answer key by hand**
- [ ] 1.8 Cold-start baseline: Claude Code, then Desktop
- [ ] 1.9 Cold-start baseline: Cowork (blocked until the MCP bridge is up)
- [ ] 1.10 Write `inventory.md` with the Disposition column filled
- [ ] Run all 7 phase-01 gates → `/gsd:verify-work`

## Phase 02 — Substrate & Authority
- [ ] `git init ~/memory` (private) with the tier skeleton
- [ ] Install `AUTHORITY.md` + `LIFECYCLE.md` verbatim from `reference/`
- [ ] Three blocking pre-commit gates: gitleaks, exclusion-grep, dupe-check
- [ ] **Adversarially test all three** — plant a fake key, an excluded term, a duplicate. All must be blocked.

## Phase 03 — Migration & De-duplication
- [ ] Adjudicate every conflict in `overlap-report.txt` (Pete only — cannot be delegated)
- [ ] Migrate canon; seed `ledger/decisions.md` and `ledger/failures.md`
- [ ] Rewrite `CLAUDE.md` as a router, < 100 lines, zero facts
- [ ] Tombstone the old locations
- [ ] Re-run probes — must not regress

## Phase 04 — Cross-Surface Wiring
- [ ] Cowork global instructions via the `cowork-context-scaffolder` skill
- [ ] Desktop project instructions
- [ ] `memory_user_edits` batch — correct blob-vs-canon contradictions (spend ≤10 of 30)
- [ ] Re-run probes — target ≥ baseline + 20pp

## Phase 05 — Ship & Tombstone
- [ ] All M01 gates green
- [ ] `git tag M01-shipped`; write `M01-retrospective.md`
- [ ] **M02 go/no-go on the number, not on momentum**

## Backlog (M02 — not yet sequenced)
- [ ] Skill-usage telemetry hook (FIRST — M03's prune needs a 30-day running start)
- [ ] **`PreCompact` promotion hook — the flagship**
- [ ] `SessionStart` injection hook (≤ 2k tokens, hard cap)
- [ ] Transcript-extraction pipeline (scrubbed → `working/_inbox/`)
- [ ] The weekly pass: slash command + Cowork scheduled task
- [ ] First live run + reconciliation batch

## Backlog (M03 — not yet sequenced)
- [ ] Full eval harness: cold-start, decay, conflict, eviction
- [ ] The five metrics + dashboard
- [ ] Skill prune 39 → ≤28, driven by real telemetry
- [ ] Regression regime

## Done

## Discovered 2026-07-12 — must appear in Phase 01 inventory
- [ ] ~/Claude Cowork/memory/memory.md — 19 blocks, UNCHANGED since 2026-04-27. Competing writer to canon.
- [ ] ~/Claude Cowork/proposals/memory-proposals.md — 69 staged, all pending, NOT promoted. First inbox batch.
- [ ] ~/Claude Cowork/proposals/unrouted/ — ~1,776 entries, untouched since 2026-04-26. THE GRAVEYARD. Inventory before anything else.
- [ ] /promote-memories parser — confidence-scored promotion, conflicts with countable-rules design. Phase 03 adjudicates. May also be silently broken (memory.md never written).
- [ ] ~/projects/claude-desktop-skills — new skills source of truth, 25 after Desktop cleanup.
