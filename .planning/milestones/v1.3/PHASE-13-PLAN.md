# Phase 13 — Config Schema Gaps

**Phase:** 13
**Milestone:** v1.3 Review Remediation
**Status:** PLANNED
**Workstream:** schemas
**Branch:** feat/phase-13-schemas
**Dependencies:** Phase 12 (SHIPPED — safeLoadPipelineConfig exists)

## Tasks

### T13.1 — excluded-terms.schema.json

**Goal:** Author and wire `config/schema/excluded-terms.schema.json` into config-validator pair-discovery.

**Schema spec:**
- Type: array of strings
- Constraints: minItems: 1, maxItems: 100
- Item constraints: minLength: 2, maxLength: 80, pattern rejects backticks and triple-colons (`pattern: "^[^`]{2,80}$"` plus negative lookahead for `:::`)
- `$id`: `excluded-terms`

**Implementation:**
1. Create `config/schema/excluded-terms.schema.json` with above spec
2. No code changes needed — config-validator auto-discovers via `config/schema/*.schema.json` glob in `discoverAndValidateAll()` (`src/config-validator.js:121-123`)
3. Verify: existing `config/excluded-terms.json` passes validation

**Tests:**
- Round-trip: current `config/excluded-terms.json` validates cleanly
- Invalid: empty array, item with backtick, item < 2 chars, array > 100 items

**Files:** `config/schema/excluded-terms.schema.json`, `test/config-validator.test.js`
**Commit:** `feat(schemas): T13.1 — excluded-terms schema`

---

### T13.2 — scheduling.schema.json

**Goal:** Author and wire `config/schema/scheduling.schema.json`.

**Schema spec:**
- Type: object
- Required: `tasks` (array, minItems: 0)
- Each task object:
  - `cron` (string, pattern: 5-field cron regex `^(\S+\s+){4}\S+$`)
  - `triggerId` (string, minLength: 1)
  - `model` (string, enum: known model IDs — `"claude-sonnet-4-5-20250929"`, `"claude-opus-4-5-20251101"`, `"claude-haiku-4-5-20251001"`)
  - All three required
- `$id`: `scheduling`

**Implementation:**
1. Create `config/schema/scheduling.schema.json`
2. Auto-discovered by config-validator pair-discovery
3. Verify: existing `config/scheduling.json` passes validation

**Tests:**
- Round-trip: current `config/scheduling.json` validates
- Invalid: bad cron (6 fields), unknown model ID, missing triggerId, empty tasks array with required task, wrong types (number for cron)

**Files:** `config/schema/scheduling.schema.json`, `test/config-validator.test.js`
**Commit:** `feat(schemas): T13.2 — scheduling schema`

---

### T13.3 — vault-paths.schema.json

**Goal:** Author and wire `config/schema/vault-paths.schema.json`.

**Schema spec:**
- Type: object
- Properties:
  - `left` (array of strings, minItems: 1) — LEFT vault paths
  - `right` (array of strings, minItems: 1) — RIGHT vault paths
  - `haikuContextChars` (integer, minimum: 0, maximum: 200000)
- Required: `left`, `right`
- Path item pattern: rejects `..` (no traversal), absolute paths (no leading `/`), backticks
  - Pattern: `^(?!.*\\.\\.)(?!/)[^`]+$`
- RIGHT-side default must include `_system/dead-letters/` (added by T12.1) — validate backward compat with existing `config/vault-paths.json`
- `$id`: `vault-paths`

**Implementation:**
1. Create `config/schema/vault-paths.schema.json`
2. Auto-discovered by config-validator pair-discovery
3. Verify: existing `config/vault-paths.json` passes (must already contain `_system/dead-letters/` on RIGHT side from T12.1)

**Tests:**
- Round-trip: current `config/vault-paths.json` validates
- Invalid: path with `..` traversal, absolute path `/etc/passwd`, empty left array, haikuContextChars out-of-range (negative, > 200000)

**Files:** `config/schema/vault-paths.schema.json`, `test/config-validator.test.js`
**Commit:** `feat(schemas): T13.3 — vault-paths schema`

---

### T13.4 — memory-categories orphan resolution

**Goal:** Resolve the orphan `config/schema/memory-categories.schema.json` by extracting categories from `config/templates.json` into `config/memory-categories.json`.

**Decision:** Extract (not delete) — the schema already exists and has value as a validation target.

**Implementation:**
1. Read `config/templates.json` to locate category data
2. Extract categories into `config/memory-categories.json`
3. Update every consumer that reads categories from `templates.json` to read from the new file
4. Verify: `memory-categories.schema.json` pair-discovery now finds its matching config file (no more WARNING in `discoverAndValidateAll`)

**Tests:**
- Schema round-trip: new `config/memory-categories.json` validates against existing schema
- Regression: memory classification behavior unchanged (existing tests still pass)

**Files:** `config/memory-categories.json`, `config/templates.json`, consumers TBD (grep for category references), `test/config-validator.test.js`
**Commit:** `feat(schemas): T13.4 — extract memory-categories config`

---

### T13.5 — centralize hardcoded config parameters

**Goal:** Move hardcoded thresholds from source files into `config/pipeline.json` under a `thresholds` block.

**Audit targets:**
| Module | Parameter | Current Value | Config Key |
|--------|-----------|---------------|------------|
| `src/memory-extractor.js` | message threshold | 2000 | `thresholds.memoryExtractorMsgLimit` |
| `src/memory-extractor.js` | chunk sizes | 100 / 10 | `thresholds.memoryChunkSize` / `thresholds.memoryChunkSmall` |
| `src/promote-memories.js` | lock timeout | 5000 (ms) | `thresholds.memoryLockTimeoutMs` |
| `src/content-policy.js` | Haiku timeout | 2000 (ms) | `thresholds.haikuTimeoutMs` |
| `src/wikilink-engine.js` | token budget | 1024 | `thresholds.wikilinkTokenBudget` |

**Implementation:**
1. Add `thresholds` block to `config/pipeline.json` with above fields and current values as defaults
2. Extend `config/schema/pipeline.schema.json` to validate the `thresholds` block (integer constraints, min/max bounds)
3. Update each module to read from config via `safeLoadPipelineConfig()` with existing numeric defaults as fallback when config is missing
4. Each module keeps its current default value as the fallback — no behavioral change

**Tests:**
- Unit test per module: assert config override is honored (set via temp config, verify module uses overridden value)
- Default path: assert module works without thresholds block in config

**Files:** `config/pipeline.json`, `config/schema/pipeline.schema.json`, `src/memory-extractor.js`, `src/promote-memories.js`, `src/content-policy.js`, `src/wikilink-engine.js`, `test/pipeline-infra.test.js` (or per-module tests)
**Commit:** `feat(schemas): T13.5 — centralize hardcoded thresholds`

---

### T13.6 — extend loadConfigWithOverlay to all config loaders

**Goal:** Apply the overlay helper to vault-paths, connectors, scheduling, and excluded-terms loaders. Remove startup warning workaround.

**Implementation:**
1. Identify all config loader functions in `src/pipeline-infra.js` (or wherever vault-paths, connectors, scheduling, excluded-terms are loaded)
2. Wrap each with `loadConfigWithOverlay()` pattern — load base config, merge `.local.json` overlay if present
3. Ensure each `.local.json` file is already in `.gitignore` (check and add if missing)
4. Remove the startup warning that flagged unused `.local.json` files
5. Verify: each loader respects overlay in test

**Tests:**
- Overlay round-trip for each loader: create temp `.local.json`, assert merged config reflects overlay values
- Base-only path: assert loader works without `.local.json`

**Files:** `src/pipeline-infra.js`, `.gitignore`, `test/pipeline-infra.test.js`
**Commit:** `feat(schemas): T13.6 — overlay helper for all config loaders`

---

## Execution Plan

**Order:** T13.1 → T13.2 → T13.3 → T13.4 → T13.5 → T13.6 (sequential, each small)

**Subagent plan:** One subagent per task, sequential. Each subagent writes schema + code + test in one commit. test-verifier after each. pipeline-reviewer after T13.6.

**Commit strategy:** 6 commits on `feat/phase-13-schemas`, Conventional Commit messages prefixed `feat(schemas): T13.X — <description>`.

## Verification

- All 6 config files have matching schemas in `config/schema/`
- `discoverAndValidateAll()` returns 0 warnings, 0 errors
- Full test suite passes (639+ tests)
- pipeline-reviewer sign-off after T13.6
- No behavioral changes — all defaults preserved

## Backlog Coverage

| Backlog ID | Addressed By |
|------------|-------------|
| B-14 | T13.1, T13.2, T13.3 (3 missing schemas) |
| B-12 | T13.4 (orphan schema resolved — AJV removeSchema path exercised less) |
| (config centralization) | T13.5 |
| (overlay adoption) | T13.6 |
