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

## Session Exemptions
- [2026-04-22] Session 11: `/prime` boot-only session. No user corrections occurred — stop hook likely triggered on BLOCK gate language from prior session context. No lesson to capture.

## Archived
<!-- Rules that no longer apply -->
