# Todo

## Session Handoff (2026-04-24)

**Last session shipped:** Phase 19 Semantic Memory Search to master (`2284fee` + STATE update `85429f3`). CI + CodeQL green on both pushes.

**Key delivery this session:**
- All 4 live-Voyage UAT items closed (Tests 1–4 pass)
- Calibration fix: `memory.semantic.threshold` 0.72 → 0.55 in `config/pipeline.json` (empirical, against `voyage-4-lite`)
- VERIFICATION.md status: `human_needed` → `passed`
- Memory file `project_second_brain.md` refreshed via dream-memory-consolidation (was 2 days stale)

**No blockers carried forward.** Phase 19 is complete and shipped.

**v1.4 remaining (per ROADMAP):** Phase 20 Instrumentation, Phase 21 Closeout Hygiene.

## Forward (v1.4 candidates — folded into Phase 21 Closeout Hygiene)

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

## v1.5 Backlog

<!-- Captured 2026-04-25. Backlog only — not scheduled. Promote to a v1.5 phase via /gsd:new-milestone when ready. -->

- [ ] **HOOK-SCHEMA-01: Pre-commit schema validation** — `scope: v1.5` `category: hooks`
  - AJV validation on `daily-stats.md` YAML frontmatter and `config/pipeline.json` on every commit; catches malformed entries and out-of-bounds config values before they land on master.
  - Rationale: Phase 19 had to ship a calibration fix (`memory.semantic.threshold` 0.72 → 0.55) after merge; Phase 20 added a `stats` sub-object schema that's only validated at runtime. A pre-commit AJV gate would have caught both classes of drift at the source instead of in production logs.

- [ ] **HOOK-VAULT-01: Pre-commit LEFT/RIGHT boundary enforcement** — `scope: v1.5` `category: hooks`
  - Git-level path check that prevents committing files to the wrong vault side; makes the LEFT/RIGHT write-permission boundary structural at the git layer, not just runtime via `vault-gateway.js`.
  - Rationale: Pattern 11 (LEFT/RIGHT as a security perimeter) is currently enforced only when the agent goes through `createVaultWriter()`. A direct manual commit, IDE drag-and-drop, or merge of an unreviewed branch can bypass the runtime check entirely. A pre-commit hook makes the perimeter structural — the flag becomes the boundary, per the pattern's definition.

- [ ] **HOOK-DOCSYNC-01: Post-merge documentation drift detection** — `scope: v1.5` `category: hooks`
  - After merge to master, compare `CLAUDE.md` stats (test count, coverage, phase count) against actual `jest --coverage` output; flag mismatches as warnings — don't block, just surface.
  - Rationale: v1.4 required a manual doc-sync after every phase ship (test counts, coverage percentages, milestone tags). Drift is silent until someone notices the README claims 982 tests and the suite actually runs 1,084. A non-blocking warning hook closes the loop without inverting the dependency on devs remembering to update three living documents.

- [ ] **AGENT-DOCSYNC-01: Post-ship documentation drift detection** — `scope: v1.5` `category: agents`
  - After each phase ships, compare `CLAUDE.md` / `README.md` stats (test count, coverage, phase count, milestone list) against actual `jest --coverage` and `git log` reality; produce a diff of stale values; block phase closure if drift exceeds threshold. Pairs with HOOK-DOCSYNC-01 — the hook fires on merge for cheap structural checks, the agent does deeper semantic comparison at phase boundary.
  - Rationale: `CLAUDE.md` test count drifted from 982 to 1,082+ across Phases 18-20 undetected. The hook (HOOK-DOCSYNC-01) catches numbers that don't match `jest`; the agent catches narrative drift the hook can't see — milestone descriptions, phase summaries, "what's shipped" prose.

- [ ] **AGENT-VERIFY-01: Requirement-level auto-verification** — `scope: v1.5` `category: agents`
  - Expand `test-verifier` to auto-run against every phase's requirements checklist, not just UAT items; spawn parallel sub-checks per requirement ID using the subagent fan-out pattern (Pattern 6 streaming + Pattern 10 write-once registration).
  - Rationale: Phase 20's verifier caught a Pattern 11 violation only because we ran it manually. Auto-spawning a sub-check per REQ-ID at phase-close time makes verification cover the full requirements surface, not just the UAT subset that happens to be in the verifier prompt.

- [ ] **AGENT-MEMORY-01: Memory health monitor** — `scope: v1.5` `category: agents`
  - Read `daily-stats.md` counters; flag anomalies: zero promotions for 3+ days, proposal backlog growing without promotions, recall usage dropping, vault size plateau. Surface anomaly alerts in the `/today` briefing output (between Memory Echo and the summary line).
  - Rationale: Compounding memory is the project's core value prop, but nothing currently monitors whether it's actually compounding. Phase 20 instrumented the counters; this is the consumer that converts counters into "is the system working" signal.
