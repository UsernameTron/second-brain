# Phase 04 — Context

**Phase name:** Cross-Surface Wiring
**Phase state:** PHASE_DISCUSSING (stub)

## Requirement

Point every surface at the new substrate. Claude Code via the CLAUDE.md router. Cowork via global instructions. Desktop via project instructions. And spend the `memory_user_edits` budget correcting the auto-memory blob where it contradicts canon.

## Inputs

- Populated `~/memory/canon/` (phase-03)
- The `cowork-context-scaffolder` skill — **already built, use it**, don't hand-write the global instructions file
- The current auto-memory blob contents, diffed against canon

## Open questions

- How much of the 30-edit `memory_user_edits` budget should M01 spend vs. reserve for M02's ongoing reconciliation? (Leaning: spend ≤10 now on the hard contradictions — identity, company, architecture, exclusions. Reserve the rest.)
- Does Desktop honor project-level instructions strongly enough to matter, or is it effectively unreachable?

## Decisions made

| Question | Decision | Rationale |
|:---|:---|:---|
| Is claude.ai chat wired in? | **No. It cannot be.** | No filesystem access. It stays capture-only per AUTHORITY.md A5. Documented as a permanent limitation rather than papered over. |

## Success looks like

Cold-start recall rises on all wired surfaces. Full lift comes in M02 — this phase should show **≥ baseline + 20pp**. If it doesn't move at all, the router isn't being read, and that is a stop-and-diagnose signal, not a proceed-anyway signal.

## Outputs

- Cowork global instructions pointing at `~/memory`
- Desktop project instructions
- A `memory_user_edits` batch correcting blob-vs-canon contradictions
- `baseline-post-M01.md` — the wired score
