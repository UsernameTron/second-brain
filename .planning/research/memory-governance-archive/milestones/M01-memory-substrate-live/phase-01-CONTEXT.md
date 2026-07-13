# Phase 01 — Context

**Phase name:** Audit & Baseline
**Phase state at authoring:** PHASE_DISCUSSING → PHASE_PLANNED

## Requirement

Before touching anything, produce two things: a complete inventory of every memory-bearing surface on the machine, and a **measured baseline** of how well the harness currently knows Pete when it starts cold. Everything downstream keys off these. Without the inventory, the migration is a guess. Without the baseline, the entire project is unfalsifiable — there is no way to answer "did this work."

## Inputs to this phase

- The `ultrathink` design pass (2026-07-12) that produced the tier model and the countable-rule constraint
- `reference/AUTHORITY.md` and `reference/LIFECYCLE.md` — the rules this build installs
- Known-but-unverified memory surfaces: `CLAUDE.md`, `~/context/`, `~/Claude Cowork/ABOUT ME/`, `~/Claude Cowork/projects/`, the Claude Desktop skills estate, GSD `.planning/` directories, the Anthropic auto-memory blob

## Open questions

- **Where exactly does `~/context/` live and what is in it?** → RESOLVED BY THIS PHASE. Discovered by the inventory script, not assumed.
- **How many memory-bearing files exist, and how much do they overlap?** → RESOLVED BY THIS PHASE. The dupe-check output is the answer.
- **Does Claude Code emit skill-invocation telemetry today?** → RESOLVED BY THIS PHASE (step 1.5). If not, M02 phase-01 must instrument it, and that decision belongs here, not later.
- **Which Claude Code hook events are available in the installed version?** → RESOLVED BY THIS PHASE (step 1.6). Verified against the live `/hooks` output rather than assumed from documentation.
- **What is the actual current skill count?** Memory says 39 Desktop skills against a 20–28 target, and separately references a 130-skill estate. → RESOLVED BY THIS PHASE. Count, don't recall.

## Decisions made

| Question | Decision | Rationale |
|:---|:---|:---|
| Audit first, or build first? | **Audit first.** Nothing gets created in this phase. | A migration built on assumed paths breaks on contact. And a build with no baseline can never be proven to have worked. |
| Who authors the probe answer key? | **Pete.** Claude authors the questions; Pete authors the answers. | Claude's model of Pete is the thing under test. It cannot also be the grader. Self-graded evals measure nothing. |
| How many probes? | **20.** Spanning canon (durable), working (volatile), ledger (failures/decisions), procedural. | Enough to be statistically meaningful at a glance; few enough to run cold on three surfaces in under an hour. |
| Baseline on how many surfaces? | **Three:** Claude Code, Claude Desktop, Cowork. | Enforcement coverage differs per surface (hooks exist only in Code). If the lift is uneven, that's a finding, not noise — and you'll only see it if you baselined per-surface. |
| Is claude.ai chat baselined? | **No.** | It cannot read the filesystem, so it is out of scope for improvement by this build. Baselining it would measure something the project isn't trying to change. Noted as a permanent limitation in `AUTHORITY.md` A5. |

## Constraints specific to this phase

- **Read-only.** This phase creates no files outside `~/memory-audit/` (a scratch directory) and modifies nothing. If a step wants to change something, it belongs in phase-02 or phase-03.
- **No fabrication.** Every path, count, and version in the inventory is discovered by a command, not recalled from memory. Anything that can't be discovered is written as an explicit open item, not a guess.
- **The MCP bridge is down** (Filesystem MCP timed out 2026-07-12). Run this phase in **Claude Code**, which has native filesystem access and doesn't depend on the Desktop MCP bridge.

## Out of scope for this phase (deferred)

- Creating the `~/memory` repo → phase-02
- Moving any content → phase-03
- Rewriting CLAUDE.md → phase-03
- Installing any hook → M02 phase-01/02/03
- Pruning any skill → M03 phase-03 (needs 30 days of telemetry first; this phase only *counts* them)

## Success looks like

- A single file lists every memory-bearing artifact on the machine, with size, last-modified, and overlap flags. Nothing is missing, and nothing is guessed.
- A single number — cold-start recall, per surface — exists on paper. It will look worse than expected. That is the point.
- Every open question above is answered by a command's output, not by an assumption.

## Outputs (what this phase produces)

- `~/memory-audit/inventory.md` — the full estate map
- `~/memory-audit/eval-probes.md` — 20 probes, with Pete's answer key
- `~/memory-audit/baseline.md` — cold-start recall scored across three surfaces
- `~/memory-audit/overlap-report.txt` — raw duplicate-content findings between CLAUDE.md / `~/context/` / ABOUT ME
- `~/memory-audit/capability-check.md` — available hook events, skill telemetry availability, actual skill count
