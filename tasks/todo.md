# Todo

## Current
- Between milestones — `/gsd:new-milestone` when ready for v1.3
- [ ] Configure branch protection (repo is public, CI passes)
- [ ] Merge `chore/commit-planning-artifacts` branch to master

## Session Handoff (Session 45 — 2026-04-23)
- Completed comprehensive 8-domain codebase review (76/100, CONDITIONAL GO)
- Branch `chore/commit-planning-artifacts` has 1 unpushed commit (3 planning artifacts)
- Top 5 remediation items for next milestone:
  1. Refactor today-command.js (724 LOC god module → 5 sub-modules)
  2. Add try/catch around loadVaultPaths() and all loadPipelineConfig() calls
  3. Add ESLint + SAST to CI pipeline
  4. Create schemas for excluded-terms.json, scheduling.json, vault-paths.json
  5. Add CI environment check to UAT tests + reduce classifier over-mocking
- Review delivered as conversation output — compare against independent analysis

## Session Handoff (Session 38 — 2026-04-23)
- Ran automation recommender: analyzed codebase for hooks, subagents, skills, MCP, CI gaps
- Added backlog 999.7–999.12 to ROADMAP.md (6 new items)
- Drafted executive proposal at `.claude/plans/cryptic-sleeping-boot.md` — 12 items with technical specs, security assessment, 4-wave priority
- Assessed streaming-agent-loop-builder skill — no value for this project (Claude Code is the agent loop)
- Branch `chore/backlog-quality-security` has 4 unpushed commits
- Next: push branch → PR → merge, then `/gsd:new-milestone` for v1.2

## Followup
- [ ] Backlog 999.1–999.12: 12 items queued in ROADMAP.md (see executive proposal at `.claude/plans/cryptic-sleeping-boot.md`)

## Completed
- [x] Deep questioning and PROJECT.md creation
- [x] Config setup (YOLO, coarse, quality models)
- [x] Domain research (4 parallel researchers: stack, features, architecture, pitfalls)
- [x] Research synthesis (SUMMARY.md)
- [x] Requirements definition (21 v1 requirements across 7 categories)
- [x] Roadmap creation (4 phases, 21/21 requirements mapped)
- [x] CLAUDE.md generated with GSD workflow guidance
- [x] Phase 1 context gathering (16 decisions)
- [x] Phase 1 research (564-line RESEARCH.md)
- [x] Phase 1 planning (2 plans, 2 waves)
- [x] Phase 1 cross-AI review (Codex — 5 HIGH concerns)
- [x] Phase 1 plan revision (all concerns addressed, verified)
- [x] Execute Phase 1: Vault Foundation (`/gsd:execute-phase 1`)
- [x] Phase 2 context gathering (68 decisions, D-01..D-68)
- [x] Phase 2 cross-AI context review (Codex + host session, 5 CRITICAL resolved)
- [x] Phase 2 planning (6 plans, 3 waves, checker PASSED)
- [x] Execute Phase 2: Content Pipeline (6/6 plans, 461 tests, 24 suites)
- [x] Phase 2 verification (gsd-verifier 6/6 must-haves PASSED)
- [x] Phase 2 post-execution code review (Gemini + host session, PASS)
- [x] Phase 3 discuss-phase complete (22 decisions, 4 areas, PR #5)
- [x] Phase 3 context refinements merged (PR #6, 6 patches from Gemini round 1)
- [x] Phase 3 plan-phase complete (4 plans, 2 waves, 897 total lines)
- [x] Phase 5 discuss-phase complete (12 decisions locked, 05-CONTEXT.md)
- [x] Phase 5 plan-phase complete (3 plans, 2 waves, checker passed after revision)
- [x] Phase 5 execution complete (3/3 plans, INTEG-01/02/03 satisfied, RemoteTrigger verified)
- [x] Phase 6 execution complete (3/3 plans, FIX-01/03/04/05 + UAT-01/02/03)
- [x] FIX-01: 3 sub-bugs fixed in promote-memories dedup
- [x] Phase 7 execution complete (CI pipeline, Node 20+22 matrix, PR #13)
- [x] v1.0 milestone completed and archived (tag v1.0)
- [x] v1.1 milestone completed and archived (tag v1.1, PRs #14-#15)
- [x] Git cleanup: 4 stale branches deleted, history reconciled
- [x] Deploy project-scoped agents (test-runner, docs-sync, vault-guardian, pipeline-reviewer) — PR #16
- [x] Sync local master to origin, delete stale local branches
- [x] Phase directory archival decision (kept in place)
- [x] v1.2 milestone finalized and tagged v1.2.0 (2026-04-23)
- [x] Config overlay system shipped (pipeline.local.json support)
- [x] v1.2 milestone audit — GO verdict (50/50 exit criteria)
- [x] Config hot-reload (FIX-02) — deferred permanently, no symptom observed
