# Harness Memory Governance

**Project type:** Platform / Infrastructure (personal AI harness)
**Initiated:** 2026-07-12
**Owner:** Pete Connor — vibecoder, sole operator
**Stakeholders:** Pete Connor (only). No external dependency.
**Repository:** `<created in M01 phase-02: ~/memory, private git repo>`
**Project slug:** `memory-governance`

---

## Purpose

The harness accumulates. It does not compound.

Two engines run today. One is automatic and dumb — the Anthropic-generated memory blob, a recency-biased rolling window that summarizes and forgets. One is manual and smart — skills, CLAUDE.md, the ABOUT ME canon, GSD planning state. The second one compounds only because Pete personally lifts knowledge into it. He is the promotion engine, and he does not scale. The evidence is already visible: 39 Claude Desktop skills against a 20–28 target, and a live CLAUDE.md ↔ `~/context/` duplication with no rule for which wins.

This project builds the substrate, the rules, and the enforcement that make every session compound into the next **without Pete carrying knowledge uphill by hand.**

When shipped: one source of truth per fact, structurally enforced. Knowledge survives context eviction instead of dying at compaction. Decisions carry status and expiry instead of drifting into "confidently stale." Failures become rules on first occurrence, not third. And there is a number — cold-start recall — that proves whether it's actually working.

---

## Success criteria

- [ ] **Cold-start recall ≥ baseline + 30pp** on a fixed 20-probe set, measured across Claude Code / Desktop / Cowork
- [ ] **Zero facts duplicated across two editable files** (verified by script, not eyeball)
- [ ] **Zero secrets and zero excluded terms** present anywhere in the memory repo (gitleaks + grep gates, enforced pre-commit)
- [ ] **Knowledge survives compaction** — a decision made mid-session is recoverable after the context window is compacted
- [ ] **Weekly pass ≤ 15 minutes** of Pete's attention, and it actually runs 4/4 weeks in the first month
- [ ] **Skill estate reaches ≤ 28**, driven by real invocation telemetry rather than vibes

---

## Scope

### In scope

- A git-backed markdown substrate (`~/memory`) as the single source of truth
- An explicit authority hierarchy that resolves every fact-type to exactly one home
- A lifecycle engine: retention, decay, promotion, reconciliation — expressed as **countable rules, not scoring rubrics**
- Claude Code hooks for deterministic enforcement (`SessionStart`, `PreCompact`, `PostToolUse`)
- A transcript-extraction pipeline (scrubbed) feeding an append-only inbox
- One weekly governance pass, scheduled, that is the only writer to canon
- Secret-scrubbing and exclusion-term gates as pre-commit blocks
- An eval harness that makes "is it getting smarter" a measurable claim
- Skill-usage telemetry, so the 39 → 28 prune is data-driven

### Out of scope (explicit)

- **Any vector store, embedding index, or semantic search over memory.** At this corpus size grep beats embeddings and costs zero maintenance. Revisit only if `canon/` exceeds ~50k tokens. This line exists to prevent scope creep into a memory-platform build.
- **Any scoring engine or weighted-rubric promotion logic.** Rules stay countable (3 mentions, 3 retrievals, 1 failure, 0 invocations). A counter is leverage scaffolding. A rubric is judgment scaffolding that will drift and rot.
- **Making claude.ai chat authoritative.** Chat cannot read the filesystem. It stays capture-only. Fighting this fights the platform.
- **Writing directly to the Anthropic auto-memory blob.** Not possible. It gets demoted to a non-authoritative cache instead.
- **New vendors, new services, new subscriptions.** This runs on filesystem + git + existing hooks + existing skills.
- **Migrating Obsidian.** The vault stays where it is. `~/memory` may be symlinked into it; the vault is not the substrate.

---

## Constraints

- **Budget:** $0. Local tooling only. Possible one-time `gitleaks` install (free, OSS).
- **Timeline:** No fixed external date. Runs alongside the ctg-secintel sprint. Realistically 3–5 weeks part-time across three milestones.
- **Compliance:** The memory repo will ingest transcripts. Transcripts contain credentials and the three permanently-excluded topics. Scrubbing is a **hard gate**, not a preference. Shipping an unscrubbed repo during an active enterprise-deal security certification would be a self-inflicted finding.
- **Operator constraint:** Sole operator. Any rule that requires more than ~15 min/week of manual work will rot and take the system with it. Design for the week Pete doesn't feel like it.
- **Platform constraint:** Deterministic enforcement exists **only in Claude Code** (hooks). Desktop and Cowork get prompt-level enforcement. Chat gets nothing. Coverage is deliberately partial and the plan says so.

---

## Key decisions to date

| Date | Decision | Rationale |
|:---|:---|:---|
| 2026-07-12 | `~/memory` git repo is the substrate — not Obsidian, not CLAUDE.md | Git already *is* a memory model: provenance = blame, tombstones = history + `supersedes:`, decay = mtime, reconciliation = diff. Don't rebuild versioning badly. |
| 2026-07-12 | CLAUDE.md becomes a **router**, holds near-zero facts | Kills the CLAUDE.md ↔ `~/context/` duplication *structurally*. You cannot have a conflict if only one file holds the fact. Same pattern as the proven `ctg-kb-router` skill. |
| 2026-07-12 | Auto-memory blob is demoted to **Tier-4, non-authoritative cache** | It cannot be written to. Stop trying to govern it; make it never authoritative and instrument its drift instead. |
| 2026-07-12 | Promotion rules are **countable, never scored** | Bitter Lesson applied inward. Counters are leverage scaffolding; rubrics are judgment scaffolding that rots. |
| 2026-07-12 | Capture is **extraction, not instrumentation** | Claude Code already writes full JSONL transcripts. The raw material exists. The gap is that nothing reads it back. Build the reader, not a second recorder. |
| 2026-07-12 | Single-writer discipline: append-only inbox during the week, canon written only by the weekly pass | Eliminates merge conflicts by construction across four concurrent Claude surfaces. |
| 2026-07-12 | Secret-scrubbing + exclusion-grep are **pre-commit blocking gates** | The capture pipeline ingests transcripts. Transcripts contain keys and excluded-topic contamination. Non-negotiable. |

---

## Related work

- Bitter Lesson audit of the 130-skill estate (leverage vs. judgment scaffolding distinction) — this project is that audit applied to memory itself
- Claude Code Extension Factory Phase 6 (Layer 0/1/2 routing) — the router pattern here is the same shape
- `ctg-portfolio` plugin (`ctg-kb-router` skill + PreToolUse hook) — proven precedent for router + hook enforcement
- Agent harness eval work — **first-pass acceptance rate** is the existing headline metric; this project's cold-start recall metric feeds it rather than competing with it
- GSD Framework v1.30.0 (61 commands, 15 agents, 5 hooks) — the execution surface
