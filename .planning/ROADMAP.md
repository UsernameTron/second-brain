# Roadmap: Second Brain

## Overview

Transform an Obsidian vault into a personal operating system with compounding memory, proactive daily briefing, intelligent input routing, and external integrations.

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped 2026-04-22)
- ✅ **v1.1 Go Live** — Phases 5-7 (shipped 2026-04-23)
- ✅ **v1.2 Automation & Quality** — Phases 8-11 (shipped 2026-04-23, tag v1.2.0)
- ✅ **v1.3 Review Remediation** — Phases 12-16 (shipped 2026-04-24, tag v1.3.0)
- ✅ **v1.4 Memory Activation & Final Closeout** — Phases 17-21 (shipped 2026-04-26, tag v1.4)
- ✅ **v1.5 Internal Hardening** — Phases 22-25 (shipped 2026-04-26, tag v1.5)
- ✅ **v1.6 Enforcement Integrity & Surface Completion** — Phases 26-28 (shipped 2026-07-15, tag v1.6)
- ✅ **v1.7 Prove Compounding** — Phases 29-31 (shipped 2026-07-16, PR #66)
- 🚧 **v1.8 Measured Memory** — Phases 32-36 (Phases 32-35 shipped: 32 on 2026-07-19 via PR #74; 33-35 on 2026-07-21 via PRs #88/#86/#89; Phase 36 decision-gated, unscheduled)

## Phases

<details open>
<summary>🚧 v1.8 Measured Memory (Phases 32-36) — Phases 32-35 SHIPPED (32: 2026-07-19; 33-35: 2026-07-21); Phase 36 decision-gated</summary>

**Prerequisite:** merge `feat/second-brain-capture-verification` (11 commits ahead of origin/master at planning time) to master before execution. — DONE.

- [x] Phase 32: Retrieval Eval Baseline — SHIPPED 2026-07-19 (PR #74). `npm run eval:recall` scores a 20-question golden set (`eval/golden-recall.json`, keyed by `content_hash`) over a frozen 135-entry seed vault with an isolated embeddings cache; recall@5 + MRR across keyword/semantic/hybrid. Baseline committed before any tuning: **keyword 0.900 / semantic 0.800 / hybrid 0.900 recall@5** (`eval/baseline-2026-07-19.json`). Two consecutive runs agreed exactly; live cache byte-identical; gate drills confirm the harness cannot silently pass. Open lead for tuning: semantic misses q10/q17 by returning nothing above the 0.55 threshold. Plan: `milestones/v1.8-phases/32-retrieval-eval/32-01-PLAN.md` · Notes: `32-01-NOTES.md`
- [x] Phase 33: Capture Reliability — SHIPPED 2026-07-21 (PR #88). Fix + version the `com.secondbrain.daily-sweep` launchd plist (verified never-fired at planning: no log file; bare `node`, no env/WorkingDirectory) and observe one real 23:45 fire FIRST; persist `state/daily-sweep-last-run.json`; `/today` Compounding line "sweep ran/staged N | STALE | NEVER RAN"; `src/utils/classifier-health.js` (voyage-health clone) gating local-27B → `classifyAnthropic` fallback, extended to HTTP/parse errors, with per-night Haiku call cap. **Planned 2026-07-21: 4 plans, 2 waves.** Requirements (derived from goal): CAP-LAUNCHD-01, CAP-CLASSIFIER-01, CAP-EVIDENCE-01.
  - [x] 33-01-PLAN.md — Launchd reliability: root-caused exit-78 (stale registration: bare `node`, no node@22 PATH), versioned + rebootstrapped the fixed plist, observed a real launchd-context fire (exit 0, 26 candidates staged) (wave 1)
  - [x] 33-02-PLAN.md — `src/utils/classifier-health.js` (voyage-health clone) + `classifier.haikuNightlyCap` config key (50) + AJV schema (wave 1)
  - [x] 33-03-PLAN.md — Wired classifier-health into `createLlmClient`: capped Haiku fallback on http/parse/timeout + degraded fast-path (wave 2)
  - [x] 33-04-PLAN.md — `state/daily-sweep-last-run.json` evidence + `/today` Compounding sweep line (ran/STALE/NEVER RAN) (wave 2)
- [x] Phase 34: Promotion Integrity & Lifecycle — SHIPPED 2026-07-21 (PR #86; close-out #87). Land filed backlog PROMOTE-PARSE-01 / PROMOTE-VAULT-01 / PROMOTE-ID-01 / VERIFY-SENTINEL-01 (`scripts/verify-baseline.js`, real exit code); contradiction check at promotion (hybrid top-5, flag-only, never block/auto-resolve); `superseded-by::` entry convention (readMemory downranks); monthly snapshot-first dream-consolidation script + launchd plist (stages for human review, no auto-apply) codifying the 2026-07-19 manual reorg. **Planned 2026-07-20: 7 plans, 5 waves.**
  - [x] 34-01-PLAN.md — Promotion gate integrity: shared `parseCheckboxState` extraction (operator hard constraint) + PROMOTE-PARSE-01 whitespace/near-miss + PROMOTE-VAULT-01 call-time root + PROMOTE-ID-01 collision-safe IDs (wave 1)
  - [x] 34-02-PLAN.md — `superseded-by::` / `stale::` read-path downrank in memory-reader.js (wave 1)
  - [x] 34-03-PLAN.md — VERIFY-SENTINEL-01: `scripts/verify-baseline.js` real exit code over the 27 pre-governance hashes + pre-push gate (wave 1)
  - [x] 34-04-PLAN.md — Shared `checkContradiction` helper + flag-only contradiction surfacing at promotion (wave 2)
  - [x] 34-05-PLAN.md — Dream config block + MERGE (mechanical quote guard) + STALE detection (wave 3)
  - [x] 34-06-PLAN.md — Dream MISSED PATTERNS + changeset writer (shared parser) + `/dream-propose` CLI + monthly plist (wave 4)
  - [x] 34-07-PLAN.md — Dream `/dream-apply`: snapshot-first + apply + `eval:recall` gate with auto-restore, human-only (wave 5)
- [x] Phase 35: Proactive Memory — SHIPPED 2026-07-21 (PR #89). SessionStart hook `.claude/hooks/session-memory-inject.js` (fail-open on infra, exit 0 always) shelling to `scripts/recall.js "<project-derived query>" --hybrid --top 5`, entries passed through the reach exporter's fail-closed `checkContent` egress loop; ~750-token hard cap; kill switch `sessionInject.enabled` + `SB_SESSION_INJECT=0`; latency gate (<1s Voyage-up, <250ms degraded).
  - [x] 35-01-PLAN.md — SessionStart proactive-memory injection hook (fail-open exit-0; in-process hybrid top-5 recall; fail-closed checkContent egress; ~750-token cap; kill switches; latency gate) (wave 1)
- [ ] Phase 36 (decision-gated, unscheduled): Ingest Breadth — Drive connector behind the `src/connectors/types.js` contract PLUS the missing connector→memory seam (no connector feeds memory.md today — gmail/calendar/github are briefing-only). Build once here, L10 RAG consumes it; do not fork. Gate: real L10 Phase 3 timeline.

Ordering rationale: eval first (no recall claim is provable without a baseline — zero eval infra existed at planning); capture second (scheduler live-broken); lifecycle before injection (inject from a store with integrity checks).

</details>

<details>
<summary>✅ v1.7 Prove Compounding (Phases 29-31) — SHIPPED 2026-07-16 (PR #66)</summary>

- [x] Phase 29: Series Integrity
- [x] Phase 30: Outcome Instrumentation
- [x] Phase 31: Trend & Report

Full details: [milestones/v1.7-ROADMAP.md](milestones/v1.7-ROADMAP.md)
Audit: [milestones/v1.7-MILESTONE-AUDIT.md](milestones/v1.7-MILESTONE-AUDIT.md)

Post-milestone follow-up (calendar-gated, ~3 weeks after ship, not a roadmap phase): VERDICT-01 — confirm scheduler alive over a trailing week, observe `computeMemoryHealth` live, archive `scripts/compounding-report.js` output with the verdict to `.planning/`.

</details>

<details>
<summary>✅ v1.6 Enforcement Integrity & Surface Completion (Phases 26-28) — SHIPPED 2026-07-15</summary>

- [x] Phase 26: Promotion Safety — completed 2026-07-15 (PR #62)
- [x] Phase 27: Context Honesty (3/3 plans) — completed 2026-07-15 (PR #63)
- [x] Phase 28: Surface Completion (3/3 plans) — completed 2026-07-15 (PR #63)

Full details: [milestones/v1.6-ROADMAP.md](milestones/v1.6-ROADMAP.md)
Audit: [milestones/v1.6-MILESTONE-AUDIT.md](milestones/v1.6-MILESTONE-AUDIT.md)

</details>

<details>
<summary>✅ v1.4 Memory Activation & Final Closeout (Phases 17-21) — SHIPPED 2026-04-26</summary>

- [x] Phase 17: UAT CI Infrastructure (3/3 plans) — completed 2026-04-24
- [x] Phase 18: Memory Retrieval Foundation (6/6 plans) — completed 2026-04-24
- [x] Phase 19: Semantic Memory Search (5/5 plans) — completed 2026-04-24
- [x] Phase 20: Value Extraction Instrumentation (5/5 plans) — completed 2026-04-25
- [x] Phase 21: Closeout Hygiene (4/4 plans) — completed 2026-04-26

Full details: [milestones/v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md)
Audit: [milestones/v1.4-MILESTONE-AUDIT.md](milestones/v1.4-MILESTONE-AUDIT.md)

</details>

<details>
<summary>✅ v1.3 Review Remediation (Phases 12-16) — SHIPPED 2026-04-24</summary>

- [x] Phase 12: Critical Safety Fixes (6/6 plans) — completed 2026-04-23
- [x] Phase 13: Config Schema Gaps — completed 2026-04-23
- [x] Phase 14: CI Hardening (5/5 plans) — completed 2026-04-24
- [x] Phase 15: Architecture Refactor — completed 2026-04-24
- [x] Phase 16: Test Quality — completed 2026-04-24

Full details: [milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md)

</details>

<details>
<summary>✅ v1.2 Automation & Quality (Phases 8-11) — SHIPPED 2026-04-23 (tag v1.2.0)</summary>

- [x] Phase 8: Hook Infrastructure (3/3 plans) — completed 2026-04-23
- [x] Phase 9: Security & Verification (3/3 plans) — completed 2026-04-23
- [x] Phase 10: Agent Hardening & Skills (2/2 plans) — completed 2026-04-23
- [x] Phase 11: CI & LLM Infrastructure (2/2 plans) — completed 2026-04-23

Full details (when archived): see `.planning/milestones/`

</details>

<details>
<summary>✅ v1.1 Go Live (Phases 5-7) — SHIPPED 2026-04-23</summary>

- [x] Phase 5: Integration Wiring (3/3 plans) — completed 2026-04-23
- [x] Phase 6: Defect Fixes and UAT (3/3 plans) — completed 2026-04-23
- [x] Phase 7: Hardening (1/1 plan) — completed 2026-04-23

Full details: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

</details>

<details>
<summary>✅ v1.0 MVP (Phases 1-4) — SHIPPED 2026-04-22</summary>

- [x] Phase 1: Vault Foundation (2/2 plans) — completed 2026-04-21
- [x] Phase 2: Content Pipeline (6/6 plans) — completed 2026-04-21
- [x] Phase 3: External Integrations (4/4 plans) — completed 2026-04-22
- [x] Phase 4: Daily Briefing and Scheduling (3/3 plans) — completed 2026-04-22

Full details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

<details>
<summary>✅ v1.5 Internal Hardening (Phases 22-25) — SHIPPED 2026-04-26</summary>

- [x] Phase 22: Committed Hooks (2/2 plans) — completed 2026-04-26
- [x] Phase 23: Doc Sync Layer (2/2 plans) — completed 2026-04-26
- [x] Phase 24: Agent Surface (2/2 plans) — completed 2026-04-26
- [x] Phase 25: Unicode Hardening & UAT Closeout (2/2 plans) — completed 2026-04-26

Full details: [milestones/v1.5-phases/](milestones/v1.5-phases/)

</details>

## Phase Details

Current-milestone (v1.8) phase details live in the v1.8 block above. Archived phase details: per-milestone files under [milestones/](milestones/) — e.g. v1.7-ROADMAP.md, v1.5-phases/.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Vault Foundation | v1.0 | 2/2 | Complete | 2026-04-21 |
| 2. Content Pipeline | v1.0 | 6/6 | Complete | 2026-04-21 |
| 3. External Integrations | v1.0 | 4/4 | Complete | 2026-04-22 |
| 4. Daily Briefing and Scheduling | v1.0 | 3/3 | Complete | 2026-04-22 |
| 5. Integration Wiring | v1.1 | 3/3 | Complete | 2026-04-23 |
| 6. Defect Fixes and UAT | v1.1 | 3/3 | Complete | 2026-04-23 |
| 7. Hardening | v1.1 | 1/1 | Complete | 2026-04-23 |
| 8. Hook Infrastructure | v1.2 | 3/3 | Complete | 2026-04-23 |
| 9. Security & Verification | v1.2 | 3/3 | Complete | 2026-04-23 |
| 10. Agent Hardening & Skills | v1.2 | 2/2 | Complete | 2026-04-23 |
| 11. CI & LLM Infrastructure | v1.2 | 2/2 | Complete | 2026-04-23 |
| 12. Critical Safety Fixes | v1.3 | 6/6 | Complete | 2026-04-23 |
| 13. Config Schema Gaps | v1.3 | — | Complete | 2026-04-23 |
| 14. CI Hardening | v1.3 | 5/5 | Complete | 2026-04-24 |
| 15. Architecture Refactor | v1.3 | — | Complete | 2026-04-24 |
| 16. Test Quality | v1.3 | — | Complete | 2026-04-24 |
| 17. UAT CI Infrastructure | v1.4 | 3/3 | Complete | 2026-04-24 |
| 18. Memory Retrieval Foundation | v1.4 | 6/6 | Complete | 2026-04-24 |
| 19. Semantic Memory Search | v1.4 | 5/5 | Complete | 2026-04-24 |
| 20. Value Extraction Instrumentation | v1.4 | 5/5 | Complete | 2026-04-25 |
| 21. Closeout Hygiene | v1.4 | 4/4 | Complete | 2026-04-26 |
| 22. Committed Hooks | v1.5 | 0/2 | Complete    | 2026-04-26 |
| 23. Doc Sync Layer | v1.5 | 2/2 | Complete    | 2026-04-26 |
| 24. Agent Surface | v1.5 | 2/2 | Complete    | 2026-04-26 |
| 25. Unicode Hardening & UAT Closeout | v1.5 | 2/2 | Complete    | 2026-04-26 |
| 26. Promotion Safety | v1.6 | — | Complete | 2026-07-15 |
| 27. Context Honesty | v1.6 | 3/3 | Complete | 2026-07-15 |
| 28. Surface Completion | v1.6 | 3/3 | Complete | 2026-07-15 |
| 29. Series Integrity | v1.7 | 2/2 | Complete    | 2026-07-15 |
| 30. Outcome Instrumentation | v1.7 | 3/3 | Complete    | 2026-07-16 |
| 31. Trend & Report | v1.7 | 2/3 | Complete    | 2026-07-16 |
| 32. Retrieval Eval Baseline | v1.8 | 1/1 | Complete    | 2026-07-19 |
| 33. Capture Reliability | v1.8 | 4/4 | Complete | 2026-07-21 |
| 34. Promotion Integrity & Lifecycle | v1.8 | 7/7 | Complete | 2026-07-21 |
| 35. Proactive Memory | v1.8 | 1/1 | Complete | 2026-07-21 |
