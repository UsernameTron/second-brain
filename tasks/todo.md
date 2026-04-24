# Todo

## Current

- [ ] Configure branch protection on master (repo is public, all CI gates green)
- [ ] Decide next move: `/gsd:discuss-phase 20` (Instrumentation, in v1.4) OR `/gsd:new-milestone` to scope v1.5

## Session Handoff (2026-04-24)

**Last session shipped:** Phase 19 Semantic Memory Search to master (`2284fee` + STATE update `85429f3`). CI + CodeQL green on both pushes.

**Key delivery this session:**
- All 4 live-Voyage UAT items closed (Tests 1–4 pass)
- Calibration fix: `memory.semantic.threshold` 0.72 → 0.55 in `config/pipeline.json` (empirical, against `voyage-4-lite`)
- VERIFICATION.md status: `human_needed` → `passed`
- Memory file `project_second_brain.md` refreshed via dream-memory-consolidation (was 2 days stale)

**No blockers carried forward.** Phase 19 is complete and shipped.

**v1.4 remaining (per ROADMAP):** Phase 20 Instrumentation, Phase 21 Closeout Hygiene.

## Forward (v1.4 candidates)

### MEDIUM priority
- [ ] B-21: UAT CI strategy — 24 UAT tests (uat-classification, uat-wikilinks) never run automatically. Phase 14 `CI=true` skip guard stops CI runs; no replacement workflow exists. Effective automated UAT coverage = 0%. Recommend scheduled `workflow_dispatch` GitHub Actions workflow with `ANTHROPIC_API_KEY` secret, runs weekly to catch model behavior drift.

### LOW priority
- [ ] B-15: Unicode-specific tests for exclusion terms / filename generation
- [ ] B-18: JSDoc on public API surface
- [ ] B-20: Decide strategy for 41 no-console warnings (suppress, logger abstraction, or accept)

## Accepted Flags (non-defects, awareness only)

- F-01: chokidar v3.6.0 (2 majors behind, CJS compat — intentional)
- F-02: docs-sync agent lacks scope_guard (cosmetic)

## Completed

### v1.3 Review Remediation — SHIPPED 2026-04-24 (tag v1.3.0, PR #30 docs close)

- [x] Phase 12: Critical Safety Fixes — PR #22 (d65b0c6)
- [x] Phase 13: Config Schema Gaps — PR #24 (774140b)
- [x] Phase 14: CI Hardening — PR #26 (a940280)
- [x] Phase 15: Architecture Refactor — PR #27
- [x] Phase 16: Test Quality — PR #29 (branch coverage 75.35% → 81.31%, CI threshold 70% → 80%)
- [x] v1.3 milestone close ceremony — PR #30 (archive, tag, retrospective)
- [x] Project finalized via `/gsd:finalize` (2026-04-24)

### v1.2 Automation & Quality — SHIPPED 2026-04-23 (tag v1.2.0)

- [x] Phase 8: Hook Infrastructure
- [x] Phase 9: Security & Verification
- [x] Phase 10: Agent Hardening & Skills
- [x] Phase 11: CI & LLM Infrastructure
- [x] Config overlay system (pipeline.local.json support)
- [x] v1.2 milestone audit — GO verdict (50/50 exit criteria)

### v1.1 Go Live — SHIPPED 2026-04-23 (tag v1.1)

- [x] Phase 5: Integration Wiring (INTEG-01/02/03)
- [x] Phase 6: Defect Fixes and UAT (FIX-01/03/04/05 + UAT-01/02/03)
- [x] Phase 7: Hardening (CI pipeline, Node 20+22 matrix)
- [x] Config hot-reload (FIX-02) — deferred permanently, no symptom observed

### v1.0 MVP — SHIPPED 2026-04-22 (tag v1.0)

- [x] Deep questioning and PROJECT.md creation
- [x] Domain research (4 parallel researchers) + synthesis
- [x] Requirements (21 v1 across 7 categories) + 4-phase roadmap
- [x] Phase 1: Vault Foundation
- [x] Phase 2: Content Pipeline
- [x] Phase 3: External Integrations
- [x] Phase 4: Daily Briefing and Scheduling
