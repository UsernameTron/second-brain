# ADR-020: Authority Hierarchy for the Four Current Stores

**Status:** Accepted (2026-07-15)
**Context:** Second Brain, v1.6 (REQ-CTX-03). Pairs with ADR-018/ADR-019 (SURFACE-REACH-01): reach without arbitration just distributes the ambiguity to more surfaces.

## Decision

Four stores currently claim to describe Pete, and today none outranks the others. This ADR ranks them, most to least authoritative:

`ABOUT ME/` canon **>** `memory.md` **>** `CLAUDE.md` **>** Anthropic auto-memory blob

| Store | Authority | Writable by |
|---|---|---|
| `ABOUT ME/` (LEFT canon) | **Highest** — identity, voice, company, standing rules. True until Pete changes it. | Human only (LEFT/RIGHT boundary already enforces this) |
| `memory.md` | **Historical record** — decisions, learnings, principles with provenance. Explains canon; never contradicts it. | Agent, via the `/promote-memories` human gate |
| `CLAUDE.md` | **Router, not a fact store** — says *where to look*, never *what is true*. A fact appearing here is a defect. | Agent + human |
| Auto-memory blob | **Lowest — non-authoritative cache.** Recency-biased, flattens "considered X" into "decided X." | Nobody (Anthropic generates it) |

### Every pairwise conflict has one winner

- `ABOUT ME/` beats `memory.md`.
- `ABOUT ME/` beats `CLAUDE.md`.
- `ABOUT ME/` beats the auto-memory blob.
- `memory.md` beats `CLAUDE.md`.
- `memory.md` beats the auto-memory blob.
- `CLAUDE.md` beats the auto-memory blob.

No pair is "it depends." The higher-ranked store always wins.

## Rules

1. **Canon wins on any conflict.** Recency is not authority — if `ABOUT ME/` is wrong, fix canon; do not route around it.
2. **One fact, one home.** Identity, company, architecture, and exclusions each resolve to exactly one file. A conflict is structurally impossible if only one store may hold a given fact-type.
3. **Provenance and status survive.** A suggestion is not a decision. The failure this prevents: Claude proposes an approach, Pete says "interesting," and six weeks later the system reports it as Pete's decision.
4. **Rule-4 — live Pete outranks stale canon.** When `ABOUT ME/` canon disagrees with what Pete says in-session, Pete wins and canon is stale: flag it immediately, in-session. Never silently defer to canon over Pete, and never silently overwrite canon without telling him. Silence in either direction is the defect.

## Rationale

On 2026-07-12 Pete accepted this as a v1.6 requirement (REQ-CTX-03), flagged during milestone open rather than added on autopilot: `memory.md`, `CLAUDE.md`, the `ABOUT ME/` canon, and the auto-memory blob all assert facts about Pete, and none outranked the others. Second Brain governed `memory.md` well and governed nothing else. A memory system that asserts a stale fact with confidence is worse than no memory system, because confidently wrong beats forgetful for damage every time — arbitration is what turns a pile of stores into a single source of truth.

## Scope

This governs the four stores Second Brain actually has today. The `~/memory/canon|ledger|working/` target architecture in [`.planning/research/AUTHORITY.md`](../.planning/research/AUTHORITY.md) is the tiered design this ADR adapts rules from — it stays research, scoped to a separate future milestone, per the ADR-019 alternatives-considered list. Nothing here presumes that layout exists.

## Consequences

- **Positive:** every pairwise conflict between the four current stores has a defined, defensible winner. `CLAUDE.md` is confirmed as a router — a fact appearing there is now a named defect, not a style choice.
- **Cost:** enforcing Rule-4 requires in-session vigilance (flagging a live disagreement with canon) rather than a mechanical check; there is no linter for "Claude noticed canon was stale."
- **Non-fatal by design:** this ADR does not change write paths or add gates — it is the arbitration rule the existing stores (and the reach pointer template) now reference.

## Provenance

Requirement: REQ-CTX-03, accepted by Pete 2026-07-12. Adapts the tiered ranking and rules A1/A2/A3 (renamed here as rules 1/2/4) from [`.planning/research/AUTHORITY.md`](../.planning/research/AUTHORITY.md), mapped onto the four stores Second Brain has today rather than the `~/memory/` target layout that document was written for.
