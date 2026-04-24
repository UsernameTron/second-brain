# Phase 16: Test Quality — Context

**Gathered:** 2026-04-24
**Status:** Ready for execution

## Phase Boundary

Lift test quality and coverage for the codebase that emerged from Phases 12-15: fewer shallow mocks, more real-code execution, branch coverage ≥ 80% overall, CI threshold ratcheted from 70% to 80%. Includes new unit tests for Phase 15 extracted modules (slippage-scanner, frog-identifier, llm-augmentation, briefing-renderer) and failure-path tests for config loaders, vault writes, and hooks.

**Not in scope:** new features, behavior changes, tests for modules not surfaced by v1.3 review findings (B-13, B-16, B-17).

## Locked Decisions

### Classifier mock reduction

- **D-01:** Rewrite `test/classifier.test.js` in place. Mock at the `createLlmClient()` layer (lower layer) rather than the `runStage0`/`runStage1`/`runStage2` layer. Existing test scenarios are preserved but their mocks are rewired to target the LLM client — real stage code executes. Scope doc's "real Stage 0/1 + mocked Stage 2" framing is superseded because all three stages call the LLM; mocking at the LLM layer is what the critique actually asks for (catch integration bugs between stages).
- **D-01a:** Cover the `stage1` / `stage2` nested objects added to `classifyInput()` success response in Phase 15. Previously uncovered.

### Hook tests

- **D-02:** Shell hook tests use simple bash assertion pattern established in Phase 12 (`test/hooks/security-scan-gate.test.sh`, 8/8 passing). Do not add `bats-core` — no new devDependency, consistent with existing test.
- **D-03:** `memory-extraction-hook.js` is Node code, tested with Jest in `test/hooks/memory-extraction-hook.test.js`. Counted as a module test, not a shell-hook test.
- **D-03a:** New shell hook tests: `auto-test.test.sh`, `protected-file-guard.test.sh`. `security-scan-gate.test.sh` already exists.

### Branch coverage

- **D-04:** Primary coverage lift targets (by branch-coverage delta, not scope-doc preference):
  - `memory-proposals.js` (57% → ≥ 80%)
  - `memory-extractor.js` (60% → ≥ 80%)
  - `classifier.js` (65% → ≥ 80%, via D-01 work)
  - Phase 15 new modules: `slippage-scanner`, `frog-identifier`, `llm-augmentation`, `briefing-renderer` (all 61-71% → ≥ 85%)
- **D-05:** Ratchet CI threshold from `branches: 70` to `branches: 80` in `.github/workflows/ci.yml` in this phase. Guards Phase 16's own PR against regression. Threshold ratchet goes in the final commit, after every coverage-lift commit.

### Malformed config tests

- **D-06:** Two direct tests for `loadConfigWithOverlay` error paths: (a) JSON parse failure, (b) schema validation failure. Covers the contract once, not per-loader.
- **D-07:** Six smoke tests — one per loader (pipeline, vault-paths, excluded-terms, scheduling, connectors, templates), each using a malformed JSON fixture. Verifies each loader wires through `loadConfigWithOverlay` correctly and surfaces the error.
- **Rejected:** full 12-test matrix (JSON + schema for every loader). Redundant — schema logic is the same across loaders.

### Vault write rejection tests

- **D-08:** 6 rejection tests total: 3 rejection types (`network failure`, `permission denied`, `LEFT-side block via vault-gateway`) × 2 callers (`promote-memories.js`, `new-command.js`). No dead-letter integration tests — already covered via existing classifier + pipeline tests.

### Test organization

- **D-09:** Phase 15 module tests live in `test/today/` (mirrors `src/today/`). Rejection tests added to existing test files where applicable (`test/new-command.test.js`) or new files (`test/promote-memories-rejection.test.js`). Config loader malformed tests in `test/config-overlay.test.js` + `test/config-loaders-malformed.test.js`.

## Execution Order

Plans execute in two waves:

**Wave 1 (parallel — pure additions, zero regression risk):**
1. `test/today/*.test.js` — 4 unit test files for Phase 15 modules
2. `test/config-overlay.test.js` + `test/config-loaders-malformed.test.js` — config failure paths
3. `test/promote-memories-rejection.test.js` + rejection cases appended to `test/new-command.test.js`
4. `test/hooks/auto-test.test.sh` + `test/hooks/protected-file-guard.test.sh` + `test/hooks/memory-extraction-hook.test.js`
5. Coverage lift: expand `test/memory-proposals.test.js` + `test/memory-extractor.test.js`

**Wave 2 (after Wave 1 passes):**
6. Rewrite `test/classifier.test.js` — mock reduction (touches existing 17 tests)
7. Ratchet CI threshold from 70 to 80

After each wave: run full coverage and confirm targets hit.

## Existing Code Insights

### Reusable test patterns
- `test/hooks/security-scan-gate.test.sh` — bash assertion pattern (Phase 12, 8/8 passing)
- `test/today-command.test.js` — jest.doMock factory pattern for connectors/pipeline
- `test/new-command.test.js` — factory helper pattern from Phase 15 (`successRight`/`successLeft`/`blocked`/`deadLettered`)

### Config loader uniformity
All 6 loaders use `loadConfigWithOverlay(name, {validate: true})` from Phase 13. Testing the overlay helper directly proves the contract for all loaders.

### Integration points
- `test/hooks/` directory exists with 1 shell test
- `test/today/` directory does not yet exist (Phase 15 only created `src/today/`)
- `jest` config in `package.json` — no separate `jest.config.js`
- Coverage thresholds live in `.github/workflows/ci.yml`, not jest config

## Deferred Ideas

- **bats-core migration**: if shell tests grow beyond ~20 assertions, consider formalizing. Not this phase.
- **Coverage for `pipeline-infra.js` branches**: not listed in scope; current coverage acceptable. Defer.
- **Ratchet branches to 90% (CI TODO)**: requires more than Phase 16's scope. Leave as TODO.
- **B-17 config debounce timing tests**: partially addressed by malformed-config tests. Full debounce timing test deferred unless trivial.

---

*Phase: 16-test-quality*
*Context gathered: 2026-04-24*
