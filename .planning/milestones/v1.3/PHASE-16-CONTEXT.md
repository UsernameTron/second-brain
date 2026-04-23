# Phase 16 — Test Quality

**Phase:** 16
**Milestone:** v1.3 Review Remediation
**Status:** PENDING
**Dependencies:** Phase 15 (refactored modules must be stable before writing new tests against them)

## Scope

### Classifier mock reduction (B-13 / R5)
- `test/classifier.test.js` mocks every stage individually — masks integration bugs
- Replace per-stage mocks with real Stage 0/1 execution + mocked Stage 2 only (Stage 2 hits LLM)
- Tests should exercise actual classification logic, not mock scaffolding

### Vault write rejection tests
- `src/promote-memories.js` — add tests for vaultWrite rejection scenarios
- `src/new-command.js` — add tests for vaultWrite rejection scenarios
- Cover: network failure, permission denied, vault-gateway LEFT-side block

### Malformed config tests
- One test per config loader for malformed JSON input
- Loaders: pipeline, vault-paths, excluded-terms, scheduling, connectors, templates
- Verify each loader returns structured error (via safeLoad wrapper from Phase 12) or throws with descriptive message

### Hook script tests
- Shell test harness for `.claude/hooks/` scripts
- Test targets: `auto-test.sh`, `protected-file-guard.sh`, `security-scan-gate.sh`
- Test cases: correct exit codes, matcher behavior, blocking vs passing paths
- Use bash test framework (bats-core or simple shell assertions)

### Branch coverage lift (B-16)
- Current: 73.77% branches (threshold 70%)
- Target: 80% branches
- Primary gap: `src/classifier.js` — land above 75% branches
- Secondary gaps identified during coverage run

## Backlog Items Addressed

| Backlog ID | Item |
|------------|------|
| B-13 | UAT tests need isolation + mock reduction |
| B-16 | Branch coverage threshold 70% → 80% |
| B-17 | Config debounce timing not tested (partial — via malformed config tests) |

## Key Files

- `test/classifier.test.js` — mock reduction
- `test/promote-memories.test.js` — rejection tests
- `test/new-command.test.js` — rejection tests
- `test/hooks/` — new directory for hook tests
- `jest.config.js` — update branch threshold from 70 to 80
