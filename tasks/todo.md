# Todo

## Session Handoff (2026-07-21 — full project audit & close-out)

**State:** Audit branch `chore/full-audit-close-2026-07-21` has 9 local commits, NOT pushed (awaiting your go). GSD health DEGRADED→HEALTHY (18 warnings→0). Suite 1470/38/1508 green, lint 0 errors, license PASS, npm audit 0 vulns, `eval:recall` exactly at baseline. Scheduled `/today` env defect fixed (dotenv-gated launchd entry) — tomorrow 06:45 fire is the live confirmation. All living docs synced (21 drift findings), backlog re-triaged, v1.8 REQUIREMENTS reconstructed. PR body ready at `.planning/PR-BODY-full-audit.md`.

**Do first next session:** push the audit branch + open the PR (needs `gh auth switch --user UsernameTron` — active account keeps reverting to peteconnorCTG, root cause still unfound).

## Next Steps (written 2026-07-21, post-audit)

1. **Ship the audit branch:** `gh auth switch --user UsernameTron`, push `chore/full-audit-close-2026-07-21`, open PR with `.planning/PR-BODY-full-audit.md`.
2. ~~**Pete-gated fixes surfaced by the audit**~~ — all three resolved 2026-07-21 via /gsd:do dispatch (quick task 260721-tx7): (a) branch protection restored + verified live; (b) schema one-liner applied with test fixtures flipped; (c) dep majors: @anthropic-ai/sdk 0.112.5 + eslint-plugin-n 18 landed (gates green), voyageai 0.4.0 rejected on evidence (breaks embed API compat + ships Unlicense transitive dep) — stays 0.2.1 exact.
3. **VERDICT-01 (~Aug 6, when ≥14 weekday rows exist):**
   - Confirm scheduler alive: a row for every weekday in the trailing week
   - Run `node scripts/compounding-report.js > .planning/reports/COMPOUNDING-VERDICT-$(date +%Y-%m-%d).md` and commit it
   - Accept the verdict honestly — `flat`/`refuted` is a valid result; it decides whether the next milestone doubles down on memory or pivots
4. **Phase 36 gate decision:** open Ingest Breadth (needs real L10 RAG Phase 3 timeline) or close v1.8 without it via the finalize milestone-archive path.
5. **Small debt, fold into any future phase:** add `scripts/**` block to `eslint.config.js` (scripts/ unlinted); review the 9 `jest/expect-expect` warnings (see `.planning/todos.md`); 3 v1.0-era subjective UAT items in `02-HUMAN-UAT.md`.
6. **Branch inventory (2026-07-21):** pruned `feat/phase-33-capture-reliability` ([gone], squash-merged #88). Remaining: `fix/extraction-failure-signal` (live remote — decide merge/close), worktree `fix-extraction-parse-and-timeout` under `.claude/worktrees/` (its guard fix appears merged — verify then remove worktree). The four v1.6-era branches from the old note are already gone.

## Active

- [ ] VERDICT-01 (~2026-08-06): archive compounding-report output with the real verdict (step 3 above)
- [ ] Pre-existing local-only failure in `test/uat/semantic-search.uat.test.js` (live Voyage UAT): fails on master with pristine deps too (3-4/5, timing-dependent) — jest sandbox + lazy undici fetch init interaction, NOT a dependency or code regression; production path verified healthy outside jest. Diagnosis evidence in `.planning/quick/260721-tx7-*/260721-tx7-SUMMARY.md`

## Completed

- [x] Push audit branch + open PR — merged as PR #90 to master (2026-07-21)
- [x] Pete-gated audit fixes via /gsd:do (2026-07-21, quick 260721-tx7): branch protection restored, schema one-liner applied, dep majors resolved (SDK+eslint-plugin-n landed, voyageai 0.4.0 evidence-rejected)
- [x] Full project audit & close-out pass (2026-07-21) — health 18 warnings→0, /today scheduled-env fix, doc sync (21 findings), backlog re-triage, in-range dep updates, all gates green; branch local pending push approval
- [x] Merge PR #66 — Milestone v1.7 Prove Compounding merged to master (2026-07-16)
- [x] Merge PR #59, /gsd:discuss-phase 26 — v1.6 shipped 2026-07-15 (stale handoff item)
- [x] Milestone v1.7 Prove Compounding finalized via /gsd:finalize (2026-07-16) — phases 29-31 verified, UAT 3/3, PR #66

## Accepted Flags (non-defects, awareness only)

- chokidar v3.6.0 (2 majors behind, CJS compat — intentional)

<!-- Resolved 2026-07-12: docs-sync scope_guard shipped as C-03 in the audit remediation. -->
<!-- Note: the F-01/F-02 IDs above collided with the Fable 5 audit's own F-01 (semantic gate) and F-02 (orphan schema). IDs dropped to avoid ambiguity. -->


## Completed

### v1.5 Internal Hardening — SHIPPED 2026-04-26 (tag v1.5, PRs #50-#53)

- [x] Phase 22: Committed Hooks (HOOK-SCHEMA-01, HOOK-VAULT-01, HOOK-DOTENV-01) — PR #50
- [x] Phase 23: Doc Sync Layer (HOOK-DOCSYNC-01, AGENT-DOCSYNC-01) — PR #51
- [x] Phase 24: Agent Surface (AGENT-VERIFY-01, AGENT-MEMORY-01) — PR #52
- [x] Phase 25: Unicode Hardening & UAT Closeout (HYG-UNICODE-02, UAT-REFRESH-01, UAT-SMOKE-01) — PR #53
- [x] v1.5 milestone finalized via /gsd:finalize (2026-04-26)

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
