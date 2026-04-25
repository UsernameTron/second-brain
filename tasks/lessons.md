# Lessons

## Active Rules

### Seed Rules
- [2026-04-21] [Config]: Never modify shared config files without checking downstream consumers.
- [2026-04-21] [Scope]: If a "quick fix" requires 3+ files, it is not quick. Re-plan.
- [2026-04-21] [Testing]: Run the full test suite, not just tests for the changed module.
- [2026-04-21] [Dependencies]: Never add dependencies without explicit user approval.
- [2026-04-21] [Data]: Never delete production data, migrations, or seed data without approval.
- [2026-04-21] [Vault]: Never surface ISPN, Genesys, or Asana content in memory promotion — hard exclusion.

### Learned Rules
- [2026-04-23] [Testing]: Never spawn multiple test/coverage processes in parallel. One invocation at a time, always with `--forceExit`. If a test command is backgrounded by the user, wait for completion notification — do not retry. Triggered by: 5 duplicate jest processes hung simultaneously, had to be killed manually, wasted 30+ minutes.
- [2026-04-23] [Review]: 3-reviewer cross-audit catches findings single-reviewer misses. Gemini caught dead-letter queue gap in memory promotion; Opus caught config-crash paths in loadPipelineConfig. Always request independent review from a second model when shipping milestone-boundary work.
- [2026-04-23] [Hygiene]: Config overlay pattern (pipeline.local.json) solves dev-workflow reversion. Ship hygiene changes ahead of feature milestones when they unblock local development — don't gate infrastructure fixes behind feature scope.
- [2026-04-23] [Hooks]: Stop hook excluded tasks/todo.md from clean-tree check, which allowed session-48 handoff state to survive uncommitted into the next session. Pattern works for rolling ledgers but surfaces ambiguity at milestone close. Future: have the stop hook prompt for commit at session end when milestone-boundary files are dirty.
- [2026-04-23] [Testing]: Do not run the full test suite as a gate on markdown-only commits (planning files, lessons, todo). Tests gate source code changes. Running Jest on a 4-file planning commit is ceremony, not discipline — and when tests are slow, it blocks the user repeatedly for zero value. Check the diff scope first; skip tests when no source/config files changed.
- [2026-04-24] [Verification]: Plan-text verification (gsd-verifier on PLAN.md) validates what the plan *promises*, not what the implementation actually ships. When a plan's must_haves include live-system behavior ("direct push rejected", "CI enforced"), the Phase-level verifier must run commands against the deployed system — not just grep plan files. Triggered by: Task 1 in Plan 17-03 shipped a `gh api` payload that omitted `required_pull_request_reviews`, but plan verification passed because the plan text was correct. Only Pete's post-merge UI audit caught the gap.
- [2026-04-24] [GitHub]: Classic branch protection's `required_status_checks` only gates PR merges — it does NOT block direct pushes. To force the PR path, `required_pull_request_reviews` must be non-null (set `required_approving_review_count: 0` for solo devs). Without the PR requirement, direct push with red CI still lands. Triggered by: BRANCH-PROT-01 shipped without the PR-required bit; direct pushes were still allowed until the fix.
- [2026-04-24] [Git workflow]: GitHub web UI edits bypass all local discipline and can introduce issues that fly past CI and review. Two direct-to-master commits via web UI during this session violated P11 (secret at workflow-level in ci.yml) and disabled CI triggers entirely. Prevention: keep `required_pull_request_reviews` on master (force PR path for UI edits too), review every commit to master in the PR it arrives via. Triggered by: b33ca14 and e4c080c on 2026-04-24, both reverted via PR #32.
- [2026-04-24] [Cache invalidation]: Before recommending a cache-bust / full-re-embed trigger, ask whether the changed value actually affects the cached artifact or only the downstream consumption. Embeddings are frozen vectors — threshold and scoring-decay factors are applied at query time to cosine results, so changing them does NOT require new embeddings. Defensive "hash everything into the version" logic creates unnecessary compute. Triggered by: Phase 19 discuss-phase — recommended composite schema_version (model + dim + decay + threshold), user corrected that threshold/decay are query-time math and re-embed on those is waste. Final lock: `schema_version = hash(model || dimension)` only.
- [2026-04-24] [Discuss-phase]: Don't lock decisions based on offhand operator comments before checking REQUIREMENTS.md / ROADMAP.md / prior phase context. Treat passing remarks as hypotheses to discuss, not as documented overrides. Why: operator-stated preferences from a different chat context are sometimes "casual reads" rather than reviewed architectural calls — locking them silently bypasses the documented spec. How to apply: when an operator preference contradicts a written REQ, surface the conflict before treating either as locked. Triggered by: Phase 20 file-path discussion — locked `RIGHT/metrics/daily-stats.md` from a casual operator read without checking that REQUIREMENTS.md said `RIGHT/daily-stats.md`. Operator caught it and asked to unlock for proper discussion.

## Session Exemptions
- [2026-04-22] Session 11: `/prime` boot-only session. No user corrections occurred — stop hook likely triggered on BLOCK gate language from prior session context. No lesson to capture.

## Archived
<!-- Rules that no longer apply -->
