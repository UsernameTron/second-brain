---
gsd_state_version: 1.0
milestone: v1.5
milestone_name: Internal Hardening
status: archived
stopped_at: "v1.5 milestone finalized — all 10 requirements complete, 4 phases shipped"
last_updated: "2026-07-12T00:00:00.000Z"
last_activity: 2026-07-12
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 8
  completed_plans: 8
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-26 after v1.5 milestone start)

**Core value:** Memory compounds daily. Every session, conversation, and capture adds to a growing knowledge base that makes tomorrow's work faster and more informed than today's.
**Status:** v1.5 archived. No active milestone.

## Current Position

Milestone: v1.5 Internal Hardening — ARCHIVED
Status: All 4 phases complete, all 10 requirements satisfied
Last activity: 2026-04-26

```
Progress: [##########] 4/4 phases complete — MILESTONE SHIPPED
```

**Shipped milestones:**

- v1.0 MVP (2026-04-22) — tag v1.0
- v1.1 Go Live (2026-04-23) — tag v1.1
- v1.2 Automation & Quality (2026-04-23) — tag v1.2.0
- v1.3 Review Remediation (2026-04-24) — tag v1.3.0
- v1.4 Memory Activation & Final Closeout (2026-04-26) — tag v1.4
- v1.5 Internal Hardening (2026-04-26) — tag v1.5

**Current milestone:** None — run `/gsd:new-milestone` to start v1.6+

## Accumulated Context

### Decisions

Full log in PROJECT.md Key Decisions table. Per-milestone summary:

- **v1.0/v1.1:** architectural + integration decisions (vault boundary, pipeline stages, connector topology)
- **v1.2:** automation & quality decisions (hooks, agents, CI, local LLM)
- **v1.3:** remediation decisions (config overlay, architecture decomposition, test quality focus)
- **v1.4:** memory activation decisions (Voyage embeddings calibrated 0.55 threshold, schema_version model+dim only, Pattern 7 degradation 3-fail/15-min, manifest-first protocol, ASCII-only matcher Path B, America/Chicago timezone, branch protection PR-required-reviews)
- [Phase 24-agent-surface]: test-verifier dual-mode: invocation phrasing triggers Phase-Closure Verification Mode; UNTESTED is distinct from PASS; grep scoped to --include=*.test.js

### Open Blockers

None active.

### Pending Todos

None — all v1.4 backlog items are now captured as v1.5 requirements in REQUIREMENTS.md.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260426-mpy | Wire up missing slash commands and extract GSD knowledge into memory proposals | 2026-04-26 | 6dccf0b | [260426-mpy](./quick/260426-mpy-wire-up-missing-slash-commands-and-extra/) |

## Session Continuity

Last session: 2026-07-12
Last activity: 2026-07-12 — Fable 5 audit remediation (14 of 16 Quick Wins), memory-corpus seeding, and v1.6 backlog capture. Full suite green (1190 tests, coverage unchanged).

**Audit remediation.** Two findings changed during execution:
- **F-01** (dead semantic excluded-terms gate) applied, but was NOT Effort-1 — it is a contract change requiring 4 test-file updates (mocks lacked `loadExcludedTerms`; integration scenario-5 injected via the now-dead pipelineConfig path).
- **F-02** (delete "orphan" daily-stats-frontmatter schema) REFUTED and reverted: the schema is used dynamically by the pre-commit hook to validate daily-stats.md frontmatter (3 tests depend on it). The audit's literal-name grep missed the dynamic linkage.
- A-01 and C-02 applied locally only (settings.local.json is gitignored; agent-memory dir was untracked — no git trace).

**Memory corpus seeded: 27 → 97 entries.** Mined 70 durable proposals from state/decisions.md, the ADR log, CTG docs, standups, and the philosophy corpus; all accepted and promoted; embeddings sidecar at 125 vectors. Keyword, semantic, and hybrid `/recall` verified against the new corpus.

**Two promotion defects found and filed for v1.6** (see REQUIREMENTS.md):
- **PROMOTE-FLAGS-01 (higher priority)** — `--dry-run` performs a REAL promotion; the flag is parsed by the wrapper but ignored by `promoteMemories()`.
- **PROMOTE-DEFER-01** — accepted candidates past the batch cap are stamped `deferred` and never re-admitted (the accept filter only takes `pending`), so a >10 batch strands the remainder permanently. This is the actual cause of the "8 deferred memory proposals" recorded in the 2026-04-26 handoff — it was misdiagnosed then as dedup logic. Worked around by promoting in batches of exactly 10.

**ADR-018 — cross-surface reach.** A Claude session with no knowledge of Second Brain spent ~4 hours independently redesigning it before discovering v1.5.0 already shipped equivalent components. Root cause is reach, not quality: nothing outside this repo names the memory layer. Filed as SURFACE-REACH-01; pairs with E-02 (staleness guard) as the "context honesty" spine of v1.6.

Ship log: PRs #1–#55. Tags: v1.0, v1.1, v1.2.0, v1.3.0, v1.4, v1.5.

## Next Action

Run `/gsd:new-milestone` to start v1.6 (Enforcement Integrity & Surface Completion) — audit §5 has the ready-to-paste block. Scope: the 3 original audit candidates (**C-01** /reroute wrapper — use `r.to`; **E-02** SessionStart staleness hook — needs threshold decision; **C-04** wire docs-sync audit mode — needs lifecycle decision) plus **SURFACE-REACH-01**, **PROMOTE-FLAGS-01**, and **PROMOTE-DEFER-01**. Also reconsider F-02's schema_version type question (schema wants string; daily-stats.js may write integer).
