# Phase 03 — Context

**Phase name:** Migration & De-duplication
**Phase state:** PHASE_DISCUSSING (stub)

## Requirement

Move canon content into `~/memory/canon/`, resolve every conflict found in phase-01, rewrite `CLAUDE.md` as a pure router holding near-zero facts, and tombstone the old locations. **This is the phase that permanently kills the CLAUDE.md ↔ `~/context/` duplication.**

## Inputs

- `inventory.md` Disposition column — this is the literal work order
- `overlap-report.txt` — the conflict list to resolve, one by one
- Existing ADRs (0002, 0003) → seed `ledger/decisions.md`
- Known scar tissue (enrichment MCP timeout) → seed `ledger/failures.md`, entry #1

## Open questions

- For each conflicting statement pair: which is correct? **Only Pete can answer.** Budget time for this — it is the real cost of the phase and it cannot be delegated.
- Does anything in `~/context/` have no home in the new tier model? If so, it may not be memory at all.

## Decisions made

| Question | Decision | Rationale |
|:---|:---|:---|
| Delete old locations, or tombstone? | **Tombstone.** | Deletion creates the "where did that go" failure. A pointer stub is nearly free and it's a signpost. |
| How thin is the router? | **Under 100 lines. Near-zero facts.** | If a fact is in CLAUDE.md, it can conflict with canon. The router says *where to look*, never *what is true*. |

## Success looks like

`dupe-check.py` returns **zero** cross-file duplicates. `CLAUDE.md` is under 100 lines. Cold-start recall does not regress from baseline (it may not rise much yet — the lifecycle engine is M02 — but it must not fall).

## Outputs

- Populated `canon/`, seeded `ledger/`
- `CLAUDE.md` rewritten as a router
- Tombstone stubs at every old location
- Re-run baseline: `baseline-post-M01.md`
