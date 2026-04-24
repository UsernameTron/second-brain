# Roadmap: Second Brain

## Overview

Transform an Obsidian vault into a personal operating system with compounding memory, proactive daily briefing, intelligent input routing, and external integrations.

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped 2026-04-22)
- ✅ **v1.1 Go Live** — Phases 5-7 (shipped 2026-04-23)
- ✅ **v1.2 Automation & Quality** — Phases 8-11 (shipped 2026-04-23, tag v1.2.0)
- ✅ **v1.3 Review Remediation** — Phases 12-16 (shipped 2026-04-24, tag v1.3.0)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-4) — SHIPPED 2026-04-22</summary>

- [x] Phase 1: Vault Foundation (2/2 plans) — completed 2026-04-21
- [x] Phase 2: Content Pipeline (6/6 plans) — completed 2026-04-21
- [x] Phase 3: External Integrations (4/4 plans) — completed 2026-04-22
- [x] Phase 4: Daily Briefing and Scheduling (3/3 plans) — completed 2026-04-22

Full details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

<details>
<summary>✅ v1.1 Go Live (Phases 5-7) — SHIPPED 2026-04-23</summary>

- [x] Phase 5: Integration Wiring (3/3 plans) — completed 2026-04-23
- [x] Phase 6: Defect Fixes and UAT (3/3 plans) — completed 2026-04-23
- [x] Phase 7: Hardening (1/1 plan) — completed 2026-04-23

Full details: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

</details>

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

## v1.2 Automation & Quality (Phases 8-11)

**Goal:** Close quality, security, and automation gaps identified by agent-teams assessment, crew analysis, and automation recommender. No new features — hardening the development workflow and CI pipeline.

### Phase 8: Hook Infrastructure
**Requirements:** HOOK-01, HOOK-02, HOOK-03
**Depends on:** None (creates .claude/settings.json as prerequisite for hooks)
**Goal:** Wire Claude Code hooks for auto-test, protected file guard, and security scan gate.

Plans:
- [ ] TBD (plan with /gsd:plan-phase 8)

### Phase 9: Security & Verification
**Requirements:** SEC-01, SEC-02, SEC-03
**Depends on:** Phase 8 (HOOK-03 depends on SEC-01 agent existing; SEC-03 skill is independent)
**Goal:** Deploy security scanner agent, independent test verifier, and config validation skill.

Plans:
- [ ] TBD (plan with /gsd:plan-phase 9)

### Phase 10: Agent Hardening & Skills
**Requirements:** SKILL-01, SKILL-02, SKILL-03
**Depends on:** Phase 9 (agent hardening informed by new agents in Phase 9)
**Goal:** Harden existing 4 agents, create pipeline health skill, install context7 MCP.

**Plans:** 2 plans

Plans:
- [x] 10-01-PLAN.md — Agent roster hardening (SKILL-01) + context7 MCP install (SKILL-03) — completed 2026-04-23
- [x] 10-02-PLAN.md — Pipeline health check skill (SKILL-02) — completed 2026-04-23

### Phase 11: CI & LLM Infrastructure
**Requirements:** CI-01, CI-02
**Depends on:** Phase 9 (CI coverage enforcement needs passing coverage baseline)
**Goal:** Enforce coverage in CI, wire local LLM as Haiku fallback.

**Plans:** 2/2 plans complete

Plans:
- [ ] 11-01-PLAN.md — Local LLM routing in createLlmClient() with Haiku fallback (CI-02)
- [ ] 11-02-PLAN.md — Coverage gap tests + CI coverage enforcement + npm audit (CI-01)

## Backlog (Post-v1.2)

All 12 items from v1.0/v1.1 backlog (999.1–999.12) promoted to v1.2 phases 8–11.
No remaining backlog items. New items added here as discovered.
