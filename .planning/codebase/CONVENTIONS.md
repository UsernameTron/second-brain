# Coding Conventions

**Analysis Date:** 2026-07-31

## Module System

**CommonJS throughout** — every `src/` and `test/` file opens with `'use strict';` then uses `require()`/`module.exports`. Confirmed via `eslint.config.js:28` (`sourceType: 'commonjs'`) and every sampled file (`src/vault-gateway.js:1-2`, `src/config-validator.js:1-2`, `src/semantic-index.js`). No ESM (`import`/`export`) anywhere in `src/` or `test/`. There is no build step — Node runs the CJS files directly (`package.json` has no `type: module`, no bundler).

## Naming Patterns

**Files:** kebab-case, `.js` extension — `vault-gateway.js`, `config-validator.js`, `memory-extractor.js`, `daily-sweep-last-run.js`. Test files mirror the source filename with `.test.js` appended: `src/daily-stats.js` → `test/daily-stats.test.js`. UAT files add a `.uat.test.js` or live under `test/uat/` with a `uat-` prefix (`test/uat/uat-classification.test.js`, `test/uat/semantic-search.uat.test.js`).

**Functions:** camelCase, verb-first — `validateFile`, `loadConfigWithOverlay`, `checkPath`, `vaultWrite`, `extractFromTranscript` (`src/config-validator.js:36`, `src/pipeline-infra.js:571`, `src/vault-gateway.js:311,421`, `src/memory-extractor.js:279`). Boolean-returning helpers read as predicates: `isDegraded`, `isHaikuCapReached`, `shouldExclude` (`src/utils/classifier-health.js`, `src/memory-extractor.js:97`).

**Private/internal helpers:** leading underscore signals "not part of the public module contract" — `_config`, `_reloading`, `_handleConfigChange`, `_COUNTER_DEFAULTS`, `_LOCK_TIMEOUT_MS` (`src/vault-gateway.js:113,199,206`, `src/daily-stats.js:273`, `src/dream.js:948-949`). This is a convention, not enforced by the module system — CJS has no real privacy.

**Constants:** UPPER_SNAKE_CASE for module-level fixed values — `VAULT_ROOT`, `CONFIG_DIR`, `DEFAULT_CONFIG_DIR`, `DEAD_LETTER_WARNING_THRESHOLD`, `NO_CONTRADICTION`, `RETRYABLE_FAILURE_MODES` (`src/vault-gateway.js:45,51`, `src/config-validator.js:26-27`, `src/briefing-helpers.js:21`, `src/contradiction-check.js:14`, `src/lifecycle.js:35`). When a "constant" needs env-var freshness at call time rather than module-load time, it becomes a zero-arg arrow function instead of a plain const — e.g. `src/memory-proposals.js:21-28` defines `VAULT_ROOT`, `PROPOSALS_DIR`, `PROPOSALS_FILE`, `PENDING_FILE`, `LOCK_FILE`, `MEMORY_FILE` all as `() => path.join(...)` so tests can swap `process.env.VAULT_ROOT` between calls without re-requiring the module.

**Error classes:** `class XError extends Error` with a `.code` string property for programmatic branching — `VaultWriteError` with codes `INVALID_PATH | PATH_BLOCKED | STYLE_VIOLATION | CONTENT_BLOCKED` (`src/vault-gateway.js:72-82`). Callers branch on `.code`, not on message-string matching.

## ESLint Configuration

Flat config at `eslint.config.js`, ESLint 10. Three blocks: base `js.configs.recommended`, a `src/**/*.js` block, and a `test/**/*.js` block with `eslint-plugin-jest` recommended rules layered in.

**Enforced in both `src/` and `test/`:**
- `no-unused-vars: error`, with `argsIgnorePattern`/`varsIgnorePattern`/`caughtErrorsIgnorePattern` all set to `^_` — prefix an intentionally-unused arg/var/caught-error with `_` (`eslint.config.js:46-50,84-88`). Sample: `catch (_) { chokidar = null; }` (`src/vault-gateway.js:31`).
- `prefer-const: error`
- `eqeqeq: error` — always `===`/`!==`.

**Differs between `src/` and `test/`:**
- `no-console`: `warn` in `src/`, `off` in `test/` (`eslint.config.js:51,89`). Production code must justify every `console.*` call with an inline `eslint-disable-next-line no-console -- <reason>` comment naming why it's there (diagnostic, user-facing-output, last-resort-error, degradation-warning). See the six labeled instances in `src/vault-gateway.js:106,214` and `src/config-validator.js:165-195` — the comment after `--` is a load-bearing category, not decoration.

Run: `npm run lint` (= `eslint src/ test/`).

## Error Handling

**Fail-closed for security/config boundaries.** Vault writes, path resolution, and config validation throw descriptive errors rather than degrade silently — `validateConfig()` throws on empty/malformed `left`/`right`/`excludedTerms` arrays or LEFT∩RIGHT overlap (`src/vault-gateway.js:128-159`); `normalizePath()` throws `VaultWriteError('INVALID_PATH')` on absolute paths, `..` traversal, or vault-root escape (`src/vault-gateway.js:271-294`).

**Fail-open for non-critical, best-effort state.** Health/counter files that merely track degraded-mode status read defaults and never throw on a missing or corrupt file — `classifier-health.readHealth()` on garbage JSON returns `{ consecutive_failures: 0, degraded_until: null }` instead of throwing (`test/utils/classifier-health.test.js:62-67`, mirrored in `src/utils/classifier-health.js`).

**Config hot-reload keeps the last-known-good config** on a parse failure rather than crashing the process — `_handleConfigChange()` catches, logs via `console.error` with an inline eslint-disable, and leaves `_config` untouched (`src/vault-gateway.js:206-219`).

**No swallowed errors.** Every `catch` either rethrows, sets an explicit fallback value, or logs before continuing — never an empty catch block. `try { chokidar = require('chokidar'); } catch (_) { chokidar = null; }` is the pattern for optional-dependency fallback (`src/vault-gateway.js:31`).

## Config Loading

**AJV schema validation is mandatory** for any config with a corresponding schema. `src/config-validator.js` compiles `config/schema/*.schema.json` against `config/*.json`, returns `{status: 'PASS'|'FAIL'|'WARNING'|'ERROR', errors: [{path, message}]}` — never throws for a normal validation failure, only for I/O/parse errors during schema loading itself (`src/config-validator.js:36-102`). This same validator runs as the `pre-commit` git hook (`hooks/pre-commit-schema-validate.js`).

**`.local.json` overlay pattern:** every config loader goes through `loadConfigWithOverlay(name, opts)` in `src/pipeline-infra.js:571`, which deep-merges a gitignored `config/{name}.local.json` over the committed `config/{name}.json`. Named wrappers exist per config: `safeLoadVaultPaths()`, `loadExcludedTerms()`, `safeLoadConnectors()`, `safeLoadScheduling()`, `safeLoadPipelineConfig()` (`src/pipeline-infra.js:484-695`). The loader self-audits: it warns to stderr if a `*.local.json` file exists but its base name isn't wired to any known loader (`src/pipeline-infra.js:604-613`) — a guard against silently-ignored local overrides.

**Test isolation via env override:** every path-sensitive module reads its root/dir from an env var with a production default — `VAULT_ROOT` (`process.env.VAULT_ROOT || '~/Claude Cowork'`), `CONFIG_DIR` (`process.env.CONFIG_DIR_OVERRIDE || <repo>/config`), cache dir (`process.env.CACHE_DIR_OVERRIDE`). Tests set these in `beforeEach`/`beforeAll` against `fs.mkdtempSync` dirs, never touching the real vault or `~/.cache/second-brain/`.

## Vault Writes

**All vault I/O routes through `src/vault-gateway.js` — no direct `fs.writeFile` to vault paths anywhere else in `src/`.** Two write entry points:
- `vaultWrite(relativePath, content, options)` — async, three sequential gates: Guard 1 path allowlist (`checkPath`), Guard 2 content-policy filter + sanitize (`checkContent`/`sanitizeContent` from `src/content-policy.js`), Guard 3 style lint (`checkStyle` from `src/style-policy.js`). Returns `{decision: 'WRITTEN'|'QUARANTINED', ...}` or throws `VaultWriteError` (`src/vault-gateway.js:421-499`).
- `vaultWriteAtomic(relativePath, content)` — sync, path-guard only (no content/style gates), for internal state files like daily-stats: writes to `${path}.tmp` then `fs.renameSync` to the real path (`src/vault-gateway.js:522-542`).

Path security is layered: reject absolute paths → reject raw `..` before normalization resolves it away → `path.normalize` → `path.resolve` against `VAULT_ROOT` to catch construction-based escapes → post-write `fs.realpathSync` check to catch symlink escapes (`src/vault-gateway.js:271-294,473-492`). Case-sensitive allowlist matching is deliberate fail-safe behavior on case-insensitive filesystems (macOS APFS) — `Memory/` does not match an allowlisted `memory` (`src/vault-gateway.js:302-305`).

Blocked content never reaches disk in readable form: `quarantine()` writes only `{original_path, reason, timestamp}` frontmatter, never the blocked content itself (`src/vault-gateway.js:375-399`).

## JSDoc

Every exported function in `src/` carries a JSDoc block: one-line summary, `@param` with type and description, `@returns`, `@throws` where applicable. See `src/vault-gateway.js:401-420` (`vaultWrite`) or `src/config-validator.js:29-35` (`validateFile`) as the reference shape — result shapes are documented inline (`Result shape: { file, schema, status, errors }`, `src/config-validator.js:14-16`) rather than via a separate types file (no TypeScript in this repo).

## Module Design

**Single-responsibility, one concern per file in `src/`**, each with a matching `test/*.test.js`. Larger modules split "coverage" concerns into a second test file when the main one grows unwieldy — e.g. `memory-extractor.test.js` + `memory-extractor-coverage.test.js`, `config-validator.test.js` + `config-validator-coverage.test.js`, `note-formatter.test.js` + `note-formatter-core.test.js` + `note-formatter-coverage.test.js`. Follow this split-by-concern pattern rather than growing one test file indefinitely.

**Exports:** a single `module.exports = { ... }` object at the bottom of the file, grouped with comment headers by concern (see `src/vault-gateway.js:601-638`: `// Core write/read`, `// Quarantine`, `// Wikilink utilities`, `// Bootstrap`, `// Config management`, `// Path security`, `// Audit logging`, `// Error class`, `// Constants`, `// Config events`). No default exports, no barrel/index files re-exporting across modules — Phase 15 explicitly removed a re-export shim from `vault-gateway.js` once grep confirmed no caller used it (`src/vault-gateway.js:594-599`); callers import directly from the owning module.

**Section comments** (`// ── Section Name ──...`) divide large files into named regions — used consistently in `vault-gateway.js`, `pipeline-infra.js`, `semantic-index.js`. Follow this banner style when adding a new logical section to an existing large file rather than introducing a different divider convention.

## Comments

Comments explain **why**, not what — design rationale, review-item references (`Addresses review item #6`, `src/vault-gateway.js:44`), invariants (`D-04 three-tier model`, `src/vault-gateway.js:327`), and ceilings on deliberate shortcuts (`ponytail: fixed pacing for free-tier Voyage limits ... Set EVAL_EMBED_PACE_MS=0 on a paid key`, `scripts/eval-recall.js:65-66`). Do not add comments that restate the next line of code.

## Gateway/Routing Split (new since PRs #90-93)

`test/today-command.gateway.test.js` covers vault-write policy for the briefing — sanitization, quarantine, the stub fallback, and dry-run routing through the gateway — and carries the isolated module-loading setup that `vault-gateway` and `style-policy` state require (both capture `VAULT_ROOT` at require time). `test/today-command.test.js` covers the orchestration chain (connector fan-out, degradation, stats payload). Add write-policy cases to the gateway file and orchestration cases to the other; section/source routing tests belong with the renderer, not here.

---

*Convention analysis: 2026-07-26*
