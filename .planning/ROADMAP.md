# Roadmap: Second Brain

## Overview

Transform an Obsidian vault into a personal operating system with compounding memory, proactive daily briefing, intelligent input routing, and external integrations.

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped 2026-04-22)
- ✅ **v1.1 Go Live** — Phases 5-7 (shipped 2026-04-23)

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

## Backlog

### Phase 999.1: Wire Local LLM (LM Studio) into Pipeline (BACKLOG)

**Goal:** Route Haiku classification calls to local LM Studio (localhost:1234) via provider-switching in createLlmClient(). Eliminates API costs for routine classification tasks on M4 Pro hardware.
**Spec:** `docs/second-brain-local-llm-backlog.md`
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.2: Independent Test Verification Gate (BACKLOG)

**Goal:** Add an independent quality gate where a separate agent re-runs the full test suite after GSD execution — not trusting the executor's self-reported results. Inspired by agent-teams Quality Agent pattern (cherry-pick 1).
**Approach:** Either enhance `/gsd:verify-work` to spawn an independent test-runner agent, or add a PostToolUse hook on phase completion that triggers a clean-context test run. Must confirm all tests pass and coverage >= 90% independently of the executor.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.4: Config/Schema Validation Agent (BACKLOG)

**Goal:** Add an agent or enhance test-runner to validate that runtime configs (`config/*.json`) match their JSON schemas (`config/schema/*.schema.json`), that config changes don't break downstream consumers, and that `scheduling.json` DST values are current.
**Approach:** Could be a standalone read-only agent or a validation step added to test-runner's workflow. Should catch: schema drift (config field added without schema update), missing required fields, scheduling.json timezone/DST staleness.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.5: Security Scanner Agent (BACKLOG)

**Goal:** Deploy a read-only security-focused agent that scans for leaked secrets, hardcoded credentials in connector configs, dependency vulnerabilities, and OAuth scope creep. Complements backlog 999.3 (mandatory scan before PR) — this agent provides the scanning capability that 999.3 gates on.
**Approach:** Read-only agent (model: sonnet) that checks: no API keys in source files, `excluded-terms.json` doesn't contain sensitive patterns, `npm audit` passes, no `gmail.send` scope references, no hardcoded localhost credentials outside config/. Deploy when 999.3 is promoted to a milestone.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.3: Mandatory Security Scan Before PR (BACKLOG)

**Goal:** Add a security agent step to `/gsd:ship` that runs OWASP checks, scans for leaked secrets (OAuth tokens, API keys), and audits dependencies before PR creation. Inspired by agent-teams Security Agent pattern (cherry-pick 2).
**Approach:** Integrate into the `/gsd:ship` pipeline as a blocking gate. Scan changed files for secrets patterns, run dependency audit (`npm audit`), check for hardcoded credentials in connector configs. Block PR creation on Critical/High findings.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.6: Agent Roster Hardening (BACKLOG)

**Goal:** Close coverage gaps and quality deficiencies identified by /gsd:crew assessment (2026-04-23). Four improvements, no new agents.
**Source:** `.claude/plans/fizzy-bubbling-willow.md` (full assessment with line-number evidence)
**Approach:**
1. **Expand pipeline-reviewer to cover today-command.js** — currently excluded by both vault-guardian and pipeline-reviewer, leaving the largest module (30KB) unreviewed. Add to component table with briefing-specific review criteria.
2. **Harden test-runner** (score 7/10, lowest) — add project root resolution, "when NOT to use" guard, redundancy guard against gsd-verifier overlap.
3. **Add severity definitions to vault-guardian** — CRITICAL/WARNING/INFO levels undefined. Also update grep patterns to catch `fs.promises.writeFile` and `writeFileSync` variants.
4. **Add test-file mapping to pipeline-reviewer** — explicit `src/{module}.js` → `test/{module}.test.js` convention table for faster reviews.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)
