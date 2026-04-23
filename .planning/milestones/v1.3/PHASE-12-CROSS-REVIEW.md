---
phase: 12
reviewers: [gemini, codex]
reviewed_at: 2026-04-23T12:00:00Z
target: test/pipeline-infra.test.js — 4 remaining failures in classifyLocal + safeLoadPipelineConfig
---

# Cross-AI Review — Phase 12 Test Regressions

## Gemini Review (Pattern)

**Question:** Is `jest.isolateModules` + temp-config-dir + `jest.doMock` the right pattern, or is there a cleaner alternative?

**Answer:** Use `jest.doMock` at the describe scope (before `jest.isolateModules`). This standard Jest pattern ensures the mock is hoisted and registered before `jest.isolateModules` loads a fresh instance of the module, guaranteeing the lazy-required dependency (`vault-gateway` inside `safeLoadPipelineConfig`) is intercepted correctly.

## Codex Review (Assertion)

**Question:** For the parse-error case, which assertion shape: SyntaxError, message pattern, or generic Error?

**Answer:** Use `expect.any(SyntaxError)` — it verifies the exact failure mode (`JSON.parse` parse failure) without brittle message matching, while being more meaningful than generic `Error`.

```js
expect(result).toEqual({
  config: null,
  error: expect.any(SyntaxError),
});
```

## Synthesis

The 4 remaining `classifyLocal` / `safeLoadPipelineConfig` test failures share a root cause: `jest.doMock('../src/vault-gateway', ...)` is called **inside** `jest.isolateModules` in `loadClientIsolated()`, but `safeLoadPipelineConfig` does a lazy `require('./vault-gateway')` at call time. Because `jest.isolateModules` creates a fresh module registry, the `jest.doMock` must be registered **before** `isolateModules` runs (at describe scope) so it's already in the parent registry when the isolated modules resolve their dependencies.

**Recommended fix:**

1. **Pattern (Gemini):** Move `jest.doMock('../src/vault-gateway', ...)` to the `beforeEach` at describe scope in the `classifyLocal` block. Keep `jest.isolateModules` for module cache isolation but let the mock registration happen before the isolation boundary.

2. **Assertion (Codex):** For the `safeLoadPipelineConfig` parse-error test, assert `expect.any(SyntaxError)` instead of generic `Error` — it's precise without being message-brittle.

**Action required:** Pete to approve before applying these changes.
