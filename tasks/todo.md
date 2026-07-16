# Todo

## Session Handoff (2026-07-12, Session 61)

**State:** v1.6 Enforcement Integrity & Surface Completion is open (Phases 26-28, 7 requirements). Memory corpus live at 97 entries. Branch `chore/fable5-audit-merge` → **PR #59, open and mergeable**.

**Do first:**

1. **Merge PR #59.** CI is red on a **pre-existing** failure — the `npm audit` step, not the tests (tests: 1154 passed / 1192 total, green on Node 20 + 22). Five CVEs live in transitive deps and this branch changes no dependency files; master's own last run failed identically.
2. **Then `/gsd:discuss-phase 26`** — Promotion Safety. It leads the milestone because the promotion workflow is now live, which makes PROMOTE-FLAGS-01 an active data-loss risk.

**Needs a decision, not just execution:**

- **Dependency CVEs** (blocking CI): `fast-uri` (high), `@babel/core`, `brace-expansion`, `js-yaml` are safe `npm audit fix` bumps. `@anthropic-ai/sdk` requires a **breaking** major (0.90 → 0.111.0). Dependencies need explicit approval — recommend a separate `chore/dep-audit` PR rather than folding an SDK upgrade into unrelated work.

**Live corpus caveats (read before touching promotion):**

- Promote in batches of **exactly 10**. Accepting more strands the remainder permanently (PROMOTE-DEFER-01).
- **`--dry-run` performs a real promotion.** The flag is parsed but ignored (PROMOTE-FLAGS-01). Do not trust it until Phase 26 lands.

## Next Steps (written 2026-07-16, post-v1.7 closeout)

**Nothing is blocking. The system now runs itself — let it collect evidence.**

1. **Let the scheduler work (no action, ~3 weeks).** launchd job `com.secondbrain.today` writes a daily-stats row every weekday 06:45. Spot-check occasionally: `node scripts/compounding-report.js` — row count should grow.
2. **VERDICT-01 (~Aug 6, when ≥14 weekday rows exist):**
   - Confirm scheduler alive: a row for every weekday in the trailing week
   - Run `node scripts/compounding-report.js > .planning/reports/COMPOUNDING-VERDICT-$(date +%Y-%m-%d).md` and commit it
   - Accept the verdict honestly — `flat`/`refuted` is a valid result; it decides whether the next milestone doubles down on memory or pivots
3. **Dependency-upgrade phase (whenever, needs your approval — breaking changes):** @anthropic-ai/sdk 0.90→0.111 (moderate CVE GHSA-p7fg-763f-g4gf), eslint/jest bumps (clears 3 dev CVEs), chokidar 5.x, voyageai 0.4.x. Run as its own `chore/dep-audit` PR: `/gsd:new-milestone` or `/gsd:quick`. See `.planning/dependencies/DEPENDENCIES-REPORT.md`.
4. **Small debt, fold into any future phase:** add `scripts/**` block to `eslint.config.js` (scripts/ files unlinted); 3 v1.0-era subjective UAT items in `02-HUMAN-UAT.md` (test in Obsidian someday or close as accepted).
5. **Branch debris (optional):** 4 local unmerged branches with no remote (`chore/session-64-wrap`, `docs/fable5-audit-2026-07-12`, 2 `worktree-agent-*`) — v1.6-era. Inspect + delete when convenient.
6. **Next milestone:** `/gsd:new-milestone` when the verdict is in — the verdict data should shape it.

## Active

- [ ] VERDICT-01 (~2026-08-06): archive compounding-report output with the real verdict (step 2 above)

## Completed

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
