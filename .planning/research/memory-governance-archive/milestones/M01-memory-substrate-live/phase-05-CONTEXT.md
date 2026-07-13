# Phase 05 — Context

**Phase name:** Ship & Tombstone
**Phase state:** PHASE_DISCUSSING (stub)

## Requirement

Close M01. Verify every gate, tag the repo, update STATE.md, and record the M01 lift honestly — including if it's disappointing.

## Decisions made

| Question | Decision | Rationale |
|:---|:---|:---|
| What if the M01 lift is flat? | **Stop. Do not start M02.** | If single-source-of-truth doesn't move cold-start recall at all, the thesis is wrong and M02 is 16 hours spent on a broken premise. Better to kill it at 13 hours than 30. This gate is real, not ceremonial. |

## Success looks like

All M01 gates green. The lift is recorded — good or bad. The go/no-go on M02 is made on the number, not on momentum.

## Outputs

- `git tag M01-shipped`
- Updated `STATE.md`
- `M01-retrospective.md` — what the lift actually was, and the explicit M02 go/no-go
