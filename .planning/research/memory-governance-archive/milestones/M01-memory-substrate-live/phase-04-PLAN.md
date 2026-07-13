# Harness Memory Governance — Phase 04
# Cross-Surface Wiring

**GSD lifecycle state:** PHASE_DISCUSSING (stub)
**Estimated build time:** ~2 hours
**Flesh out:** when phase-03 ships

> **Stub.**

## What you're building

The adapters. Every surface learns where canon lives and that canon outranks it. Deliberately thin — if Anthropic changes the platform, you rewrite adapters and keep the substrate. That's why the substrate is boring on purpose.

## Sections to author

- **4.1 — Claude Code:** CLAUDE.md router live (already done in 3.5; verify it's actually being read by asking a cold probe)
- **4.2 — Cowork:** run the `cowork-context-scaffolder` skill against `~/memory`. **Requires the MCP bridge to be back up** (see phase-01 §0.1).
- **4.3 — Desktop:** project instructions pointing at the authority hierarchy
- **4.4 — `memory_user_edits` batch:** diff the blob against canon, correct the contradictions, spend ≤10 of the 30-edit budget
- **4.5 — Re-run all 20 probes** on all three surfaces

## Validation gates

| Gate | Pass criterion |
|:---|:---|
| Router is read | A cold probe on each surface correctly names where canon lives (probe 20) |
| Lift | Cold-start recall ≥ baseline + 20pp |
| No contradiction | Blob no longer contradicts canon on identity / company / architecture / exclusions |

## Rollback

Revert global and project instructions to their prior text. Remove the `memory_user_edits`. The substrate stays; it's simply unreferenced and harmless.
