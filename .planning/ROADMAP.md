# Roadmap: Second Brain

## Overview

Transform an Obsidian vault into a personal operating system by establishing write-permission boundaries, building content capture and memory compounding pipelines, wiring external data sources, and delivering a proactive daily briefing that runs unattended.

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped 2026-04-22)
- 🔄 **v1.1 Go Live** — Phases 5-7 (active)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-4) — SHIPPED 2026-04-22</summary>

- [x] Phase 1: Vault Foundation (2/2 plans) — completed 2026-04-21
- [x] Phase 2: Content Pipeline (6/6 plans) — completed 2026-04-21
- [x] Phase 3: External Integrations (4/4 plans) — completed 2026-04-22
- [x] Phase 4: Daily Briefing and Scheduling (3/3 plans) — completed 2026-04-22

Full details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

## v1.1 Phases

- [ ] **Phase 5: Integration Wiring** — Wire gmail-mcp-pete OAuth, activate RemoteTrigger cron, expand excluded terms
- [ ] **Phase 6: Defect Fixes and UAT** — Fix in-batch dedup and config hot-reload; validate classification, wikilinks, and end-to-end UX
- [ ] **Phase 7: Hardening** — GitHub Actions CI pipeline running full test suite on push

## Phase Details

### Phase 5: Integration Wiring
**Goal**: The system runs unattended on real credentials and real data
**Depends on**: Nothing (first v1.1 phase)
**Requirements**: INTEG-01, INTEG-02, INTEG-03
**Success Criteria** (what must be TRUE):
  1. `/today` fetches live Gmail data through gmail-mcp-pete using real OAuth credentials (no stubs, no fixture data)
  2. RemoteTrigger fires automatically before 7 AM on a real cron schedule and delivers a complete briefing
  3. Submitting a capture containing a former-employer or project codename is silently dropped by the excluded-terms filter (15-20 terms active)
**Plans:** 1/3 plans executed

Plans:
- [x] 05-01-PLAN.md — Gmail OAuth bootstrap and live API wiring (gmail-mcp-pete)
- [ ] 05-02-PLAN.md — Excluded terms expansion and substring matching update
- [ ] 05-03-PLAN.md — RemoteTrigger activation (delete test, create real, verify fire)

### Phase 6: Defect Fixes and UAT
**Goal**: Known defects are gone and the full capture-to-memory flow works correctly under real-world inputs
**Depends on**: Phase 5 (UAT exercises live Gmail and RemoteTrigger paths)
**Requirements**: FIX-01, FIX-02, UAT-01, UAT-02, UAT-03
**Success Criteria** (what must be TRUE):
  1. Promoting a batch of memories with duplicate contentHashes results in exactly one entry per unique hash in memory.md
  2. Editing the config file takes effect without restarting the Node process
  3. 10+ diverse real captures routed through `/new` produce correct left/right classification at >80% accuracy
  4. Promoted memories produce at least one meaningful wikilink back-reference to existing vault content
  5. The full capture → classify → propose → promote flow completes in Obsidian vault UI without manual workarounds
**Plans**: TBD

### Phase 7: Hardening
**Goal**: Every push to master is automatically verified by the test suite
**Depends on**: Phase 6
**Requirements**: CI-01
**Success Criteria** (what must be TRUE):
  1. A push to master or an open PR triggers a GitHub Actions workflow that runs the full 502+ test suite
  2. A failing test causes the CI run to fail with a visible error in the PR checks panel
  3. A green CI badge is visible on the repo README
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Vault Foundation | v1.0 | 2/2 | Complete | 2026-04-21 |
| 2. Content Pipeline | v1.0 | 6/6 | Complete | 2026-04-21 |
| 3. External Integrations | v1.0 | 4/4 | Complete | 2026-04-22 |
| 4. Daily Briefing and Scheduling | v1.0 | 3/3 | Complete | 2026-04-22 |
| 5. Integration Wiring | v1.1 | 1/3 | In Progress|  |
| 6. Defect Fixes and UAT | v1.1 | 0/? | Not started | - |
| 7. Hardening | v1.1 | 0/? | Not started | - |
