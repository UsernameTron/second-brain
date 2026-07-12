# ADR-018: Cross-Surface Reach for the Memory Layer

**Status:** Accepted (2026-07-12)
**Context:** Second Brain, v1.6 candidate

## Decision

The memory layer must be discoverable from every Claude surface Pete uses — Desktop, Cowork, and chat sessions — not only from inside `~/projects/second-brain` in Claude Code. At minimum, surface-level instructions must name `memory.md` as the canonical memory store and point at this project as the system that owns it.

## Rationale

On 2026-07-12 a separate Claude session, with no knowledge that Second Brain existed, was asked to diagnose why the harness "accumulates but doesn't compound." It spent roughly four hours independently designing a memory-governance system — authority hierarchy, retention/decay/promotion rules, security gates — before filesystem discovery revealed that Second Brain had already shipped v1.5.0 with equivalent or better versions of every component it had designed.

The root cause is reach, not quality. The cross-session memory blob has never referenced Second Brain, and neither have the Desktop/Cowork instruction layers. Nothing outside this repository knows the system exists, so every other surface is structurally blind to it.

The near-miss is the argument. An agent with no knowledge of Second Brain designed Second Brain from scratch in four hours at decent quality; the harness's ignorance of its own memory system nearly cost a 30-hour rebuild of a shipped v1.5. A memory system that no other surface can see will be reinvented by the next surface that needs one.

## Consequences

- **Positive:** No future session redesigns a shipped system. Memory written in one surface is reachable from the others, which is the precondition for the compounding thesis to hold outside Claude Code.
- **Cost:** Instruction-layer content must be maintained in more than one place until a single canonical pointer exists; each surface added is another place that can drift stale.
- **Follow-up:** Tracked as requirement `SURFACE-REACH-01` in the v1.6 milestone.

## Provenance

Full incident narrative in the private session decision log (`state/decisions.md`, 2026-07-12 — gitignored). This ADR is the committed record.
