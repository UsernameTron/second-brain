---
phase: 03-external-integrations
plan: "01"
subsystem: connector-infrastructure
tags: [connectors, source-enum, result-shape, config-validation, test-helpers]
one_liner: "Frozen SOURCE enum, D-15 uniform result shape factories, full JSON Schema config validation, and Wave 2 test helpers"
depends_on: []
provides_for: [03-02, 03-03, 03-04]
affects: []
tech_stack:
  added: []
  patterns: [source-enum, uniform-result-shape, memoized-config-loader, inline-json-schema-validator]
key_files:
  created:
    - src/connectors/types.js
    - src/utils/validate-schema.js
    - config/connectors.json
    - config/schema/connectors.schema.json
    - test/connectors/types.test.js
    - test/connectors/helpers.js
  modified: []
decisions:
  - "CONFIG_DIR resolved lazily inside loadConnectorsConfig (not at module load) so CONFIG_DIR_OVERRIDE env var works correctly in tests"
  - "Custom validateAgainstSchema in src/utils/validate-schema.js — follows project pattern from test/config-schemas.test.js rather than adding ajv (not in package.json)"
  - "getConnectorsConfig memoized with module-level variable — connector code calls this rather than loadConnectorsConfig to avoid repeated file I/O"
metrics:
  duration_seconds: 170
  completed_date: "2026-04-22"
  tasks_completed: 2
  files_created: 6
  tests_added: 27
requirements: [INTG-01, INTG-02, INTG-03]
---

# Phase 3 Plan 01: Connector Infrastructure Summary

## Objective

Create shared connector infrastructure for all three Phase 3 connectors: SOURCE enum, uniform result shape factories, config file with schema validation, and shared test helpers.

## What Was Built

### src/connectors/types.js

Provides the foundational types and utilities all connectors import:

- **SOURCE enum**: Frozen object with exactly 3 values (`CALENDAR`, `GMAIL`, `GITHUB`). Object.freeze() prevents mutation at runtime.
- **makeResult(source, data)**: Returns exact 5-field D-15 success shape `{ success: true, data, error: null, source, fetchedAt }`. Throws on invalid source.
- **makeError(source, errorMessage)**: Returns exact 5-field D-15 error shape `{ success: false, data: null, error, source, fetchedAt }`. Throws on invalid source.
- **loadConnectorsConfig()**: Reads `config/connectors.json`, validates against `connectors.schema.json` using full recursive JSON Schema validation (not just top-level key checks). Throws with descriptive message on any violation.
- **getConnectorsConfig()**: Memoized lazy wrapper — connectors call this to avoid repeated file I/O while keeping fail-fast semantics on first use.

### src/utils/validate-schema.js

Lightweight recursive JSON Schema validator extracted as a reusable utility. Handles: object/string/integer/number/boolean/array types, required fields, minimum/maximum, minLength, minItems/maxItems, additionalProperties: false. Returns `{ valid, errors[] }` — never throws.

Follows the project's existing inline validator pattern (from `test/config-schemas.test.js`) rather than adding `ajv` as a dependency.

### config/connectors.json + config/schema/connectors.schema.json

Runtime config for all three connectors with full schema enforcement:
- Calendar: working hours (8-18), excludeDeclined, 24h default window
- Gmail: VIP senders, 24h window, 20 max results
- GitHub: UsernameTron owner, second-brain repo, 24h window

Schema enforces types, integer minimum constraints, minItems, and additionalProperties: false.

### test/connectors/helpers.js + test/connectors/types.test.js

- **helpers.js**: Three Jest assertion helpers (`assertSuccessShape`, `assertErrorShape`, `assertSourceEnum`) for Wave 2 connector tests to assert D-15 contract compliance on every return value. Checks exact 5-field shape with no extra fields allowed.
- **types.test.js**: 27 tests covering SOURCE enum properties, makeResult/makeError shapes and validation, loadConnectorsConfig loading and schema validation scenarios, and getConnectorsConfig memoization.

## Decisions Made

1. **CONFIG_DIR resolved lazily** — `loadConnectorsConfig` resolves `CONFIG_DIR` at call time (not module load time) so `CONFIG_DIR_OVERRIDE` env var in tests takes effect correctly. The pipeline-infra.js pattern resolves at module load time but that breaks test isolation for functions called from tests.

2. **Custom schema validator in src/utils/ rather than ajv** — `ajv` is not in package.json. The project already has an inline validator in `test/config-schemas.test.js`. Promoted the pattern to a reusable utility in `src/utils/validate-schema.js` so production code can use it (not just tests).

3. **getConnectorsConfig memoized at module level** — Wave 2 connectors call `getConnectorsConfig()` rather than `loadConnectorsConfig()` directly. This avoids per-call file I/O while preserving fail-fast behavior on first invocation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CONFIG_DIR must be resolved lazily, not at module load time**
- **Found during:** Task 1 verification (8 tests failing after GREEN implementation)
- **Issue:** `const CONFIG_DIR = process.env.CONFIG_DIR_OVERRIDE || path.join(...)` at module top level means the env override is evaluated once on import, before tests set it. Tests calling `withTempConfig` set `CONFIG_DIR_OVERRIDE` after module import, so the module always used the project config directory.
- **Fix:** Replaced module-level constant with `_getConfigDir()` function called inside `loadConnectorsConfig()` on each invocation.
- **Files modified:** `src/connectors/types.js`
- **Impact:** All 8 config loading tests now pass. No behavioral change in production (env var still respected).

## Test Results

```
Test Suites: 1 passed, 1 total
Tests:       27 passed, 27 total
Time:        0.085s
```

All 27 tests pass. No skipped tests. No stub patterns found in any plan file.

## Self-Check: PASSED

- [x] src/connectors/types.js exists and exports SOURCE, makeResult, makeError, loadConnectorsConfig, getConnectorsConfig
- [x] src/utils/validate-schema.js exists and exports validateAgainstSchema
- [x] config/connectors.json exists with calendar, gmail, github sections
- [x] config/schema/connectors.schema.json exists with `"required": ["calendar", "gmail", "github"]`
- [x] test/connectors/types.test.js passes with 27 tests
- [x] test/connectors/helpers.js loads cleanly and exports all 3 assertion functions
- [x] Task 1 commit: c4670b6
- [x] Task 2 commit: 4b649b3
- [x] No connector-specific code in this plan (Wave 2 scope)
- [x] Zero stub patterns found
