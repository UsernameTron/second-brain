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

### Phase 999.7: Auto-Run Tests Hook (BACKLOG)

**Goal:** Add a PostToolUse hook that auto-runs the related Jest test file after any src/ edit. Catches regressions at edit time instead of waiting for manual test runs or CI.
**Source:** Automation recommender analysis (2026-04-23), plan `cryptic-sleeping-boot.md`
**Approach:** PostToolUse hook on Write|Edit matcher. Extracts edited file path, maps `src/{module}.js` → `test/{module}.test.js`, runs matching test silently. Timeout 30s. Config in `.claude/settings.json`.
**Backlog alignment:** Complements 999.2 (test verification gate) — 999.2 is post-execution independent verification, this is per-edit fast feedback.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.8: Protected File Edit Guard (BACKLOG)

**Goal:** Add a PreToolUse hook that blocks edits to config schemas (`config/schemas/`), env templates (`.env*`), and credential files without explicit approval. Currently no guard — these files govern runtime behavior across the entire pipeline.
**Source:** Automation recommender analysis (2026-04-23), plan `cryptic-sleeping-boot.md`
**Approach:** PreToolUse hook on Write|Edit matcher. Checks file path against protected patterns, exits 2 (block) with descriptive message. Timeout 5s. Config in `.claude/settings.json`.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.9: Pipeline Health Check Skill (BACKLOG)

**Goal:** Create a `/pipeline-health` skill that provides operational visibility across the 6-module pipeline (classifier → content-policy → style-policy → vault-gateway → memory-extractor → lifecycle). No quick way to check health today.
**Source:** Automation recommender analysis (2026-04-23), plan `cryptic-sleeping-boot.md`
**Approach:** User-only skill at `.claude/skills/pipeline-health/SKILL.md`. Scans dead-letter directory for frozen items, validates config against schemas, checks connector reachability, reports retry queue depth and archive stats.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.10: Config Validator Skill (BACKLOG)

**Goal:** Create a skill that validates all `config/*.json` files against their JSON schemas in `config/schemas/`. Currently validation only runs in Jest tests — no on-demand or proactive check.
**Source:** Automation recommender analysis (2026-04-23), plan `cryptic-sleeping-boot.md`
**Approach:** Skill at `.claude/skills/config-validator/SKILL.md`. Claude can invoke proactively after config edits. Validates structure, reports mismatches, checks for schema drift (config field added without schema update).
**Backlog alignment:** Closes 999.4 (config/schema validation) via skill rather than standalone agent.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.11: context7 MCP and Project .mcp.json (BACKLOG)

**Goal:** Install context7 MCP server for live SDK documentation lookup and create a project-level `.mcp.json` making MCP configurations portable and documented.
**Source:** Automation recommender analysis (2026-04-23), plan `cryptic-sleeping-boot.md`
**Approach:** (1) `claude mcp add context7 -- npx -y @upstreamapi/context7-mcp@latest` for live docs on `@anthropic-ai/sdk`, `gray-matter`, `chokidar`. (2) Create `.mcp.json` at project root with server definitions for obsidian-mcp, github-official, and Google Calendar — currently only configured at system level.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.12: CI Coverage Reporting and Dependency Audit (BACKLOG)

**Goal:** Add Jest `--coverage` enforcement and `npm audit --production` to GitHub Actions CI pipeline. Currently no coverage data and no dependency scanning in CI.
**Source:** Automation recommender analysis (2026-04-23), plan `cryptic-sleeping-boot.md`
**Approach:** (1) Add `--coverage --coverageThreshold='{"global":{"lines":90}}'` to Jest CI step. (2) Add `npm audit --production` as a separate CI step. Aligns with global CLAUDE.md >=90% coverage requirement and backlog 999.3 security posture.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)
