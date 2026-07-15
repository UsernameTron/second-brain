# ADR-019: Reach Layer Mechanism — Pointer + Capped Digest Export

**Status:** Accepted (2026-07-15)
**Context:** Second Brain, v1.6 (SURFACE-REACH-01). Implements the requirement recorded in ADR-018.

## Decision

Cross-surface reach is implemented as a **push-on-promotion pointer + capped-digest cache**, plus a **standalone pull CLI**:

1. **Push:** after every real promotion, `src/reach-exporter.js` regenerates a single file (`second-brain.md`) plus an idempotent `MEMORY.md` index line inside an explicit allowlist of Claude Code auto-memory directories (`config/reach-targets.json`; default: the user-level and projects-workspace slugs). The file names `$VAULT_ROOT/memory/memory.md` as the canonical store, gives the live query command, and embeds the N (default 10) most recent promoted entries.
2. **Pull:** `scripts/recall.js` makes `/recall` runnable from any directory and any session on the machine — the pointer's "query it live" instruction is executable, not aspirational.

## Constraints honored

- **Exclusion gate at egress, fail-closed.** Every digest entry re-passes `content-policy.js` `checkContent` before export; BLOCK or gate error excludes the entry. This is mandatory, not belt-and-suspenders: the extraction→staging path writes proposals without passing the ingress gate, so memory.md content is not guaranteed clean.
- **LEFT/RIGHT boundary.** The exporter reads only `memory/memory.md` (RIGHT, agent-written) via `memory-reader`. LEFT content is untouched by construction.
- **AUTHORITY A2/A3 (one fact, one home; caches marked as caches).** The exported file is stamped "generated cache — the canonical store wins," carries a generated-at timestamp (visible staleness, LIFECYCLE D5), and is regenerated wholesale each run so drift is bounded by the last promotion and never accumulates.
- **Countable rules (LIFECYCLE).** Digest size is a counter (`digestMax`), targets are an explicit allowlist, missing targets are skipped never created. No scoring, no classifier in the loop beyond the existing content-policy gate.

## Alternatives considered

- **Pointer-only (no digest):** strictest one-fact-one-home reading, but gives discovery without availability — other sessions would have to execute a command to see anything. Rejected (user call, 2026-07-15).
- **MCP server exposing /recall:** live pull from Desktop/chat, but adds a dependency, an auth surface, and per-surface configuration outside this repo. Deferred; the exporter's design does not preclude it.
- **Bootstrap the `~/memory/` canon store (AUTHORITY/LIFECYCLE target architecture):** the right long-term home, but a separate milestone-sized build. This ADR is forward-compatible with it — the reach file is a cache regardless of which canonical store it points at.
- **Full replication into every project's auto-memory:** maximum reach, unbounded drift, violates A3. Rejected.

## Consequences

- **Positive:** any allowlisted Claude Code surface discovers second-brain at session start via its memory index; the ADR-018 near-miss (a parallel session redesigning a shipped system) is structurally prevented on those surfaces. Knowledge is visible without execution and queryable live with one command.
- **Cost:** the digest is stale between promotions (bounded, stamped); each new target is an allowlist edit; claude.ai chat remains out of direct reach (AUTHORITY A5 — capture-mediated only), and Desktop/Cowork instruction layers still need their one-line pointer added manually per ADR-018.
- **Non-fatal by design:** reach export failure never breaks promotion (same pattern as embed-on-promotion); per-target failures are reported in the promotion result's `reach` field.

## Provenance

Requirement: ADR-018 / SURFACE-REACH-01. Design inputs: `.planning/research/AUTHORITY.md`, `.planning/research/LIFECYCLE.md`. Payload and target-scope decisions made by Pete, 2026-07-15.
