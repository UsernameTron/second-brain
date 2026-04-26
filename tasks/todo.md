# Todo

## v1.5 Internal Hardening — Active

Promoted from v1.4 backlog on 2026-04-26. All items documented below with descriptions and sources.

### Hooks

- [ ] **HOOK-SCHEMA-01: Pre-commit schema validation**
  - AJV validation on `daily-stats.md` YAML frontmatter and `config/pipeline.json` on every commit; catches malformed entries and out-of-bounds config values before they land on master.
  - Rationale: Phase 19 had to ship a calibration fix (`memory.semantic.threshold` 0.72 → 0.55) after merge; Phase 20 added a `stats` sub-object schema that's only validated at runtime. A pre-commit AJV gate would have caught both classes of drift at the source instead of in production logs.

- [ ] **HOOK-VAULT-01: Pre-commit LEFT/RIGHT boundary enforcement**
  - Git-level path check that prevents committing files to the wrong vault side; makes the LEFT/RIGHT write-permission boundary structural at the git layer, not just runtime via `vault-gateway.js`.
  - Rationale: Pattern 11 (LEFT/RIGHT as a security perimeter) is currently enforced only when the agent goes through `createVaultWriter()`. A direct manual commit, IDE drag-and-drop, or merge of an unreviewed branch can bypass the runtime check entirely. A pre-commit hook makes the perimeter structural.

- [ ] **HOOK-DOCSYNC-01: Post-merge documentation drift detection**
  - After merge to master, compare `CLAUDE.md` stats (test count, coverage, phase count) against actual `jest --coverage` output; flag mismatches as warnings — don't block, just surface.
  - Rationale: v1.4 required a manual doc-sync after every phase ship. Drift is silent until someone notices the README claims 982 tests and the suite actually runs 1,084. A non-blocking warning hook closes the loop.

- [ ] **HOOK-DOTENV-01: Entry-point-only dotenv loading**
  - Library modules call `dotenv.config()` directly (root cause: `src/pipeline-infra.js:23`); should move to entry-point only.
  - Surfaced during pre-flight for v1.4 Phase 21.

### Agents

- [ ] **AGENT-DOCSYNC-01: Post-ship documentation drift detection**
  - After each phase ships, compare `CLAUDE.md` / `README.md` stats against actual `jest --coverage` and `git log` reality; produce a diff of stale values; block phase closure if drift exceeds threshold. Pairs with HOOK-DOCSYNC-01.
  - Rationale: `CLAUDE.md` test count drifted from 982 to 1,082+ across Phases 18-20 undetected. The hook catches numbers; the agent catches narrative drift.

- [ ] **AGENT-VERIFY-01: Requirement-level auto-verification**
  - Expand `test-verifier` to auto-run against every phase's requirements checklist, not just UAT items; spawn parallel sub-checks per requirement ID using the subagent fan-out pattern.
  - Rationale: Phase 20's verifier caught a Pattern 11 violation only because we ran it manually. Auto-spawning a sub-check per REQ-ID at phase-close time makes verification cover the full requirements surface.

- [ ] **AGENT-MEMORY-01: Memory health monitor**
  - Read `daily-stats.md` counters; flag anomalies: zero promotions for 3+ days, proposal backlog growing without promotions, recall usage dropping, vault size plateau. Surface anomaly alerts in `/today` briefing.
  - Rationale: Compounding memory is the project's core value prop, but nothing currently monitors whether it's actually compounding. Phase 20 instrumented the counters; this is the consumer.

### Test / Hygiene

- [ ] **UAT-CORPUS-REFRESH-01: Rebaseline classification corpus**
  - UAT-01 classification accuracy=0 locally — corpus drift vs current classifier behavior (suggestive: EDGE-02 returns BLOCKED for excluded-term test). Either rebaseline corpus or accept as known-stale.
  - Surfaced 2026-04-25 pre-flight; CI-skipped via existing describeFn guard so non-blocking for v1.4 ship.

- [ ] **HYG-UNICODE-02: Unicode-variant matcher upgrade**
  - Replace `.toLowerCase().includes()` at `src/content-policy.js:160,201` with NFKD-normalized matching that catches full-width Latin, soft-hyphen-injected, and non-ASCII-whitespace variants of excluded terms; backfill the 45 `test.todo()` blocks added in Plan 21-01.
  - Risk: matcher semantics change ripples through classifier and vault-gateway perimeters; needs full UAT sweep.

### Audit Carry-Forward

- [ ] **Phase 17 UAT workflow smoke run** — `gh workflow run uat.yml`. Deferred per Pete's 17-03 checkpoint; carried forward from v1.4.

## Accepted Flags (non-defects, awareness only)

- F-01: chokidar v3.6.0 (2 majors behind, CJS compat — intentional)
- F-02: docs-sync agent lacks scope_guard (cosmetic)

## Completed

### v1.4 Memory Activation & Final Closeout — SHIPPED 2026-04-26 (tag v1.4, PRs #25-#49)

- [x] Phase 17: UAT CI Infrastructure
- [x] Phase 18: Memory Retrieval Foundation
- [x] Phase 19: Semantic Memory Search
- [x] Phase 20: Value Extraction Instrumentation
- [x] Phase 21: Closeout Hygiene (B-15, B-18, B-20 shipped here)
- [x] v1.4 milestone close ceremony — PR #49

### v1.3 Review Remediation — SHIPPED 2026-04-24 (tag v1.3.0, PR #30 docs close)

- [x] Phase 12: Critical Safety Fixes — PR #22
- [x] Phase 13: Config Schema Gaps — PR #24
- [x] Phase 14: CI Hardening — PR #26
- [x] Phase 15: Architecture Refactor — PR #27
- [x] Phase 16: Test Quality — PR #29

### v1.2 Automation & Quality — SHIPPED 2026-04-23 (tag v1.2.0)

- [x] Phases 8-11: Hooks, Security, Agent Hardening, CI & LLM

### v1.1 Go Live — SHIPPED 2026-04-23 (tag v1.1)

- [x] Phases 5-7: Integration, Defect Fixes, Hardening

### v1.0 MVP — SHIPPED 2026-04-22 (tag v1.0)

- [x] Phases 1-4: Vault Foundation, Content Pipeline, External Integrations, Daily Briefing
