# Harness Memory Governance — Phase 05
# Ship & Tombstone

**GSD lifecycle state:** PHASE_DISCUSSING (stub)
**Estimated build time:** ~1 hour

> **Stub.**

## What you're building

The close-out. And a real go/no-go gate on M02.

## Sections to author

- **5.1 —** Run every M01 gate. All green, or the milestone doesn't ship.
- **5.2 —** `/gsd:verify-work`, then `/gsd:audit-milestone`
- **5.3 —** `git tag M01-shipped`
- **5.4 —** Update `STATE.md`; write `M01-retrospective.md`
- **5.5 — The M02 go/no-go.** Did cold-start recall move ≥ +20pp? If yes, proceed. **If no, stop and re-diagnose.** Do not build M02 out of sunk cost.

## Validation gates

| Gate | Pass criterion |
|:---|:---|
| All M01 gates | Green |
| Lift recorded | A real number, honestly reported, including if it disappoints |
| Go/no-go made | Explicit, written down, based on the number and not on how much work is already done |
