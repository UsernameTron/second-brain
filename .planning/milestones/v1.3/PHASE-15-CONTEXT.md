# Phase 15 — Architecture Refactor

**Phase:** 15
**Milestone:** v1.3 Review Remediation
**Status:** PENDING
**Dependencies:** Phase 13 (config loaders must be stable before refactoring modules that use them)

## Scope

### today-command.js decomposition (B-07 / R2)
- Current: 724 LOC god module handling slippage scanning, frog identification, briefing rendering, LLM augmentation, and orchestration
- Target: <= 200 LOC orchestration shell + 4 extracted modules
- Extract to:
  - `src/today/slippage-scanner.js` — deadline/overdue detection logic
  - `src/today/frog-identifier.js` — priority task identification ("eat the frog")
  - `src/today/briefing-renderer.js` — markdown formatting and section assembly
  - `src/today/llm-augmentation.js` — LLM-powered summary and insight generation
  - `src/today-command.js` — orchestration only, calls sub-modules, <= 150 LOC target (200 LOC ceiling)
- Each extracted module must be independently testable
- Existing tests must continue passing (refactor, not rewrite)

### vault-gateway cleanup
- Remove content-policy and style-policy re-exports from `src/vault-gateway.js`
- Callers import `content-policy.js` and `style-policy.js` directly
- Verify no callers use the re-export path before removing

### memory-proposals privatization
- `acquireLock()` and `releaseLock()` are exported from `src/memory-proposals.js` but should be internal
- Drop from `module.exports`
- Verify no external callers (grep for require/import references)

### new-command dedup
- `src/new-command.js` has duplicated classifier orchestration logic
- Should call `classifyInput()` instead of running Stage 0/1/2 inline
- Deduplicate by extracting shared orchestration or calling classifier directly

## Backlog Items Addressed

| Backlog ID | Item |
|------------|------|
| B-07 | today-command.js god module decomposition |

## Key Files

- `src/today-command.js` — primary refactor target (724 LOC → ≤200)
- `src/today/` — new directory for extracted modules
- `src/vault-gateway.js` — remove re-exports
- `src/memory-proposals.js` — privatize lock functions
- `src/new-command.js` — dedup classifier orchestration
- `test/today-command.test.js` — must keep passing
