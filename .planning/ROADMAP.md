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

## Phases

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

### Phase 22: Committed Hooks
**Goal**: The git pre-commit layer enforces schema validity, vault boundary integrity, and dotenv discipline automatically — no manual review needed to catch these classes of defects
**Depends on**: Phase 21 (v1.4 complete)
**Requirements**: HOOK-SCHEMA-01, HOOK-VAULT-01, HOOK-DOTENV-01
**Success Criteria** (what must be TRUE):
  1. Attempting to commit a malformed `daily-stats.md` frontmatter or out-of-bounds `config/pipeline.json` value fails at `git commit` time with a descriptive AJV error
  2. Attempting to commit a file to the wrong vault side (LEFT vs RIGHT) is blocked by the pre-commit hook before the commit lands
  3. `dotenv.config()` calls exist only at entry points; no library module re-loads env at import time; `src/pipeline-infra.js:23` root cause is resolved
  4. All three hooks are committed to `.git/hooks/` (or equivalent project hook config) and activate automatically for new checkouts
**Plans:** 2/2 plans complete

Plans:
- [x] 22-01-PLAN.md -- Pre-commit schema validation (AJV) and vault boundary enforcement hooks
- [x] 22-02-PLAN.md -- Dotenv entry-point refactor (remove side-effect from pipeline-infra.js)

### Phase 23: Doc Sync Layer
**Goal**: Documentation drift between living docs and code reality is detected automatically — once at merge time (non-blocking warning) and once at phase closure (blocking if threshold exceeded)
**Depends on**: Phase 22
**Requirements**: HOOK-DOCSYNC-01, AGENT-DOCSYNC-01
**Success Criteria** (what must be TRUE):
  1. After a merge to master, the post-merge hook compares `CLAUDE.md`/`README.md` stats (test count, coverage) against live `jest --coverage` output and prints a warning if any stat is stale
  2. At phase closure, the `docs-sync` agent compares living-doc narrative against `jest --coverage` and `git log` reality and blocks closure if any stat drift exceeds the configured threshold
  3. A correctly synced state produces no warnings or block from either the hook or the agent
**Plans:** 2/2 plans complete

Plans:
- [x] 23-01-PLAN.md — Post-merge hook with drift detection, threshold config, and tests
- [x] 23-02-PLAN.md — Extend docs-sync agent with Phase-Closure Audit Mode

### Phase 24: Agent Surface
**Goal**: Requirement coverage is automatically verifiable at phase close, and memory health anomalies surface in the daily briefing before they compound into data quality problems
**Depends on**: Phase 22
**Requirements**: AGENT-VERIFY-01, AGENT-MEMORY-01
**Success Criteria** (what must be TRUE):
  1. At phase-close time, `test-verifier` spawns parallel sub-checks per REQ-ID and returns a pass/fail verdict for every requirement in the phase — not just a bulk coverage number
  2. `/today` includes a memory health section when any anomaly condition is met: zero promotions for 3+ consecutive days, backlog growth trend, recall usage drop, or vault plateau
  3. Memory health section is absent (no false alerts) when daily-stats counters show normal operation
**Plans**: TBD

### Phase 25: Unicode Hardening & UAT Closeout
**Goal**: Excluded-term matching is Unicode-safe and auditably correct, the UAT classification corpus reflects current classifier behavior, and the Phase 17 UAT workflow smoke run is confirmed complete
**Depends on**: Phase 24
**Requirements**: HYG-UNICODE-02, UAT-REFRESH-01, UAT-SMOKE-01
**Success Criteria** (what must be TRUE):
  1. The 45 `test.todo()` blocks in `test/content-policy.test.js` are promoted to passing tests that cover Unicode-variant inputs (e.g., café, naïve, résumé forms) against the excluded-terms list
  2. `src/content-policy.js:160,201` uses NFKD-normalized matching; ASCII-only `.toLowerCase().includes()` is removed
  3. `test/uat/uat-classification.test.js` produces a meaningful accuracy score locally against the rebaselined corpus — no stale or ambiguous fixture data
  4. `gh workflow run uat.yml` fires, executes to completion, and a UAT accuracy report artifact is available in GitHub Actions (Phase 17 carry-forward closed)
**Plans:** 2 plans

Plans:
- [ ] 25-01-PLAN.md -- NFKD-normalized Unicode matcher and 45 promoted test assertions
- [ ] 25-02-PLAN.md -- UAT corpus rebaseline and Phase 17 workflow smoke run

**UI hint**: no

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
<<<<<<< HEAD
| 24. Agent Surface | v1.5 | 2/2 | Complete    | 2026-04-26 |
| 25. Unicode Hardening & UAT Closeout | v1.5 | 2/2 | Complete    | 2026-04-26 |
=======
| 24. Agent Surface | v1.5 | 1/2 | Complete    | 2026-04-26 |
| 25. Unicode Hardening & UAT Closeout | v1.5 | 0/TBD | Complete    | 2026-04-26 |
>>>>>>> 2bb974d (docs(phase-25): complete phase execution — Unicode hardening and UAT closeout)
