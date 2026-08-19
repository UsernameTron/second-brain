# Coding Conventions

**Analysis Date:** 2026-08-19

This repo has two independently-governed codebases sharing one git tree: the
**root** (`src/`, `test/`, `hooks/`) is the second-brain vault engine; the
**`agent-canvas/` subtree** is a separate Node/Express/React app with its own
`package.json`, its own test runner, and its own `CLAUDE.md` house rules. Root
conventions below apply to `src/`/`test/`; the Agent Canvas section covers
what differs.

## Module System

**CommonJS throughout the root** — every `src/` and `test/` file opens with
`'use strict';` then uses `require()`/`module.exports`. Confirmed via
`eslint.config.js:28` (`sourceType: 'commonjs'`) and every sampled file
(`src/vault-gateway.js:1-2`, `src/config-validator.js:1-2`). No ESM anywhere
in root `src/` or `test/`. No build step — Node runs the CJS files directly
(no `type: module`, no bundler in root `package.json`).

**Agent Canvas backend is also CommonJS** (`agent-canvas/server/index.js:1`,
`'use strict'` + `require()`), but **`agent-canvas/frontend/` is ESM**
(`frontend/package.json:6` sets `"type": "module"`) and is a React/Vite app —
JSX, `import`/`export`, transpiled by Vite. Do not carry root's CJS
assumptions into `frontend/`.

## Naming Patterns

**Files (root):** kebab-case, `.js` extension — `vault-gateway.js`,
`config-validator.js`, `memory-extractor.js`. Test files mirror the source
filename with `.test.js` appended: `src/daily-stats.js` →
`test/daily-stats.test.js`. UAT files add `.uat.test.js` or live under
`test/uat/` with a `uat-` prefix.

**Files (agent-canvas):** kebab-case for both backend (`server/standing-rules.js`,
`server/gcp-identity.js`) and test files (`test/agent-authority.test.js`,
`test/canvas-files-tool.test.js`). Frontend component tests use `.test.jsx`
(`frontend/test/workspace-cleanup.test.jsx`, `frontend/test/api-upload.test.jsx`).

**Functions:** camelCase, verb-first — `validateFile`, `loadConfigWithOverlay`,
`vaultWrite` (root: `src/config-validator.js:36`, `src/vault-gateway.js:311,421`).
Boolean-returning helpers read as predicates: `isDegraded`, `shouldExclude`.

**Private/internal helpers:** leading underscore signals "not part of the
public module contract" — `_config`, `_reloading`, `_handleConfigChange`
(`src/vault-gateway.js:113,199,206`). Convention only, not enforced by CJS.

**Constants:** UPPER_SNAKE_CASE for module-level fixed values — `VAULT_ROOT`,
`CONFIG_DIR`, `PORT` (root: `src/vault-gateway.js:45,51`; agent-canvas:
`server/index.js:17`). When a "constant" needs env-var freshness at call time
rather than module-load time, it becomes a zero-arg arrow function instead —
`src/memory-proposals.js:21-28` defines path constants as `() => path.join(...)`
so tests can swap `process.env.VAULT_ROOT` between calls without re-requiring.

**Error classes:** `class XError extends Error` with a `.code` string property
for programmatic branching — `VaultWriteError` with codes
`INVALID_PATH | PATH_BLOCKED | STYLE_VIOLATION | CONTENT_BLOCKED`
(`src/vault-gateway.js:72-82`). Callers branch on `.code`, not message text.

## ESLint Configuration (root only)

Flat config at `eslint.config.js`, ESLint 10. Three blocks: base
`js.configs.recommended`, a `src/**/*.js` block, and a `test/**/*.js` block
with `eslint-plugin-jest` recommended rules layered in. `agent-canvas/` is
outside `src/`/`test/` glob scope and is **not linted by root ESLint** — it
has no linter of its own (`agent-canvas/package.json` has no `lint` script).

**Enforced in both `src/` and `test/`:**
- `no-unused-vars: error`, with `argsIgnorePattern`/`varsIgnorePattern`/
  `caughtErrorsIgnorePattern` all set to `^_` — prefix an intentionally-unused
  arg/var/caught-error with `_` (`eslint.config.js:46-50,84-88`).
- `prefer-const: error`
- `eqeqeq: error` — always `===`/`!==`.

**Differs between `src/` and `test/`:**
- `no-console`: `warn` in `src/`, `off` in `test/` (`eslint.config.js:51,89`).
  Production code must justify every `console.*` call with an inline
  `eslint-disable-next-line no-console -- <reason>` comment naming why it's
  there (diagnostic, user-facing-output, last-resort-error,
  degradation-warning). See `src/vault-gateway.js:106,214`,
  `src/config-validator.js:165-195` — the comment after `--` is a load-bearing
  category, not decoration.

Run: `npm run lint` (root, = `eslint src/ test/`).

## Error Handling

**Fail-closed for security/config boundaries.** Vault writes, path
resolution, and config validation throw descriptive errors rather than
degrade silently — `validateConfig()` throws on empty/malformed
`left`/`right`/`excludedTerms` arrays or LEFT∩RIGHT overlap
(`src/vault-gateway.js:128-159`); `normalizePath()` throws
`VaultWriteError('INVALID_PATH')` on absolute paths, `..` traversal, or
vault-root escape (`src/vault-gateway.js:271-294`).

**Fail-open for non-critical, best-effort state.** Health/counter files that
merely track degraded-mode status read defaults and never throw on a missing
or corrupt file — `classifier-health.readHealth()` on garbage JSON returns
`{ consecutive_failures: 0, degraded_until: null }` instead of throwing.

**Config hot-reload keeps the last-known-good config** on a parse failure
rather than crashing the process — `_handleConfigChange()` catches, logs via
`console.error` with an inline eslint-disable, leaves `_config` untouched
(`src/vault-gateway.js:206-219`).

**No swallowed errors.** Every `catch` either rethrows, sets an explicit
fallback value, or logs before continuing — never an empty catch block.
`try { chokidar = require('chokidar'); } catch (_) { chokidar = null; }` is
the pattern for optional-dependency fallback (`src/vault-gateway.js:31`).

**Agent Canvas backend uses inline `//` rationale comments ahead of security-
relevant branches**, explaining the specific attack/failure being guarded
against rather than just what the code does — e.g. the raw-upload body-parser
exclusion in `server/index.js:26-33` explains why `express.json()` must never
touch the file-upload route (caller-controlled `Content-Type` could otherwise
smuggle a parsed object into a route that assumes a `Buffer`).

## Config Loading (root)

**AJV schema validation is mandatory** for any config with a corresponding
schema. `src/config-validator.js` compiles `config/schema/*.schema.json`
against `config/*.json`, returns
`{status: 'PASS'|'FAIL'|'WARNING'|'ERROR', errors: [{path, message}]}` — never
throws for a normal validation failure, only for I/O/parse errors during
schema loading itself (`src/config-validator.js:36-102`). This same validator
runs as the `pre-commit` git hook (`hooks/pre-commit-schema-validate.js`).

**`.local.json` overlay pattern:** every config loader goes through
`loadConfigWithOverlay(name, opts)` in `src/pipeline-infra.js:571`, which
deep-merges a gitignored `config/{name}.local.json` over the committed
`config/{name}.json`. Named wrappers exist per config: `safeLoadVaultPaths()`,
`loadExcludedTerms()`, `safeLoadConnectors()`, `safeLoadScheduling()`,
`safeLoadPipelineConfig()` (`src/pipeline-infra.js:484-695`). The loader
self-audits: it warns to stderr if a `*.local.json` file exists but its base
name isn't wired to any known loader (`src/pipeline-infra.js:604-613`) — a
guard against silently-ignored local overrides. This pattern is root-only;
`agent-canvas/` reads config via plain `process.env.*` (see
`agent-canvas/server/config/`), no AJV, no overlay.

**Test isolation via env override:** every path-sensitive module reads its
root/dir from an env var with a production default — `VAULT_ROOT`,
`CONFIG_DIR_OVERRIDE`, `CACHE_DIR_OVERRIDE`. Tests set these in
`beforeEach`/`beforeAll` against `fs.mkdtempSync` dirs, never touching the
real vault or `~/.cache/second-brain/`. Agent Canvas tests use the same
env-override-plus-mkdtemp idiom against `DATA_DIR`
(`agent-canvas/test/rooms.test.js:11`).

## Vault Writes (root only)

**All vault I/O routes through `src/vault-gateway.js` — no direct
`fs.writeFile` to vault paths anywhere else in `src/`.** Two write entry
points:
- `vaultWrite(relativePath, content, options)` — async, three sequential
  gates: Guard 1 path allowlist (`checkPath`), Guard 2 content-policy filter +
  sanitize (`checkContent`/`sanitizeContent`), Guard 3 style lint
  (`checkStyle`). Returns `{decision: 'WRITTEN'|'QUARANTINED', ...}` or
  throws `VaultWriteError` (`src/vault-gateway.js:421-499`).
- `vaultWriteAtomic(relativePath, content)` — sync, path-guard only, for
  internal state files like daily-stats: writes to `${path}.tmp` then
  `fs.renameSync` (`src/vault-gateway.js:522-542`).

Path security is layered: reject absolute paths → reject raw `..` before
normalization resolves it away → `path.normalize` → `path.resolve` against
`VAULT_ROOT` → post-write `fs.realpathSync` check to catch symlink escapes.
Case-sensitive allowlist matching is deliberate fail-safe behavior on
case-insensitive filesystems (macOS APFS).

## JSDoc (root)

Every exported function in `src/` carries a JSDoc block: one-line summary,
`@param` with type and description, `@returns`, `@throws` where applicable
(`src/vault-gateway.js:401-420`, `src/config-validator.js:29-35`). Result
shapes are documented inline rather than via a types file (no TypeScript in
this repo, root or agent-canvas).

## Module Design

**Root: single-responsibility, one concern per file in `src/`**, each with a
matching `test/*.test.js`. Larger modules split "coverage" concerns into a
second test file when the main one grows unwieldy — e.g.
`memory-extractor.test.js` + `memory-extractor-coverage.test.js`. Follow this
split-by-concern pattern rather than growing one test file indefinitely.

**Exports:** a single `module.exports = { ... }` object at the bottom of the
file, grouped with comment headers by concern (`src/vault-gateway.js:601-638`).
No default exports, no barrel/index files re-exporting across modules —
callers import directly from the owning module.

**Agent Canvas backend follows the same single-file-per-concern shape**
(`server/rooms.js`, `server/evidence.js`, `server/standing-rules.js`, each
with `server/orchestrator/`, `server/mcp/`, `server/google/`, `server/hubspot/`
subdirectories for provider-specific integration code) but does not use JSDoc
blocks as consistently as root `src/` — inline `//` comments carry the
rationale instead.

**Section comments** (`// ── Section Name ──...`) divide large root files into
named regions — used consistently in `vault-gateway.js`, `pipeline-infra.js`,
`semantic-index.js`. Follow this banner style when adding a new logical
section to an existing large root file.

## Comments

Comments explain **why**, not what — design rationale, review-item
references (`Addresses review item #6`, `src/vault-gateway.js:44`),
invariants, and ceilings on deliberate shortcuts (`ponytail: fixed pacing for
free-tier Voyage limits ... Set EVAL_EMBED_PACE_MS=0 on a paid key`,
`scripts/eval-recall.js:65-66`). Do not add comments that restate the next
line of code. Agent Canvas backend leans harder on this than root — nearly
every security- or ordering-sensitive branch in `server/index.js` and
`server/rooms.js` carries a comment naming the failure mode it prevents, not
just what the code does.

## Git Hooks

Repo-managed at root: `npm run prepare` sets `core.hooksPath=hooks`
(`package.json:14`), so `hooks/` is a **live** hook directory, not a
`.git/hooks/` template — every clone that runs `npm install` gets these hooks
active automatically.

- `hooks/pre-commit` — runs `pre-commit-schema-validate.js` (AJV config
  validation), `pre-commit-vault-boundary.js` (LEFT/RIGHT boundary check),
  `scripts/validate-archive.js` (archive integrity), in sequence,
  `set -euo pipefail` so any failure blocks the commit.
- `hooks/pre-push` — blocks the push if current branch is based on a stale
  local `master`, then runs `pre-push-docsync.js` (bypass `SKIP_DOCSYNC=1`)
  and `scripts/verify-baseline.js` (bypass `SKIP_BASELINE=1`).
- `hooks/post-merge` — docs drift warning; non-blocking by design, never
  exits non-zero.

These git hooks apply repo-wide, including changes under `agent-canvas/` —
there is no separate git-hook scope for the subtree. Claude Code hooks
(`.claude/hooks/`) are a distinct mechanism from git hooks; `auto-test.sh`
runs the matching `test/{basename}.test.js` on every source-file save.

## Commit and PR Conventions

One logical change per commit, imperative-mood messages (see recent root
history: `test(agent-canvas): stabilize PDF parser bound`,
`agent-canvas: keep healthy connectors available`,
`agent-canvas: harden documents and connector scopes`,
`feat(agent-canvas): add enrichment and document intake`). Agent Canvas
commits are prefixed `agent-canvas:` or `type(agent-canvas):` (`fix`, `feat`,
`test`) to distinguish subtree changes from root changes in shared history.
Never push directly to `master`; branch, then merge locally and push a new
branch for PR review (repo-wide rule, not agent-canvas-specific). PRs are
referenced by number in both root and agent-canvas docs as durable evidence
anchors — e.g. `docs/HANDOFF.md:16-19` cites "PR #207 merged as `049bb81`;
PR #208 merged as `9a6abaf`" rather than describing the change prose-only.

## Agent Canvas House Rules

Defined in `agent-canvas/CLAUDE.md`, which explicitly defers workflow
authority to the repo-root `CLAUDE.md` but adds subtree-specific rules:

**Documentation classification (`docs/README.md`)** — every doc under
`agent-canvas/docs/` (plus root-of-subtree `README.md`/`CLAUDE.md`) is
classified into exactly one of three tiers, enforced structurally by
`test/docs-contract.test.js`:
1. **Current operational** — `HANDOFF.md`, `DEPLOY.md`, `DEVOPS-HANDOFF.md`,
   `ROADMAP.md`, `README.md`, `CLAUDE.md`.
2. **Reference** — describes an optional external tool surface
   (`HUBSPOT-AGENT-CLI.md`, `FRONTEND-SPEC.md`); does not prove anything is
   live.
3. **Historical** — preserved for decision/failure rationale only
   (`HANDOFF-HISTORY.md`, `AUTONOMOUS-EXECUTION.md`, `GO-LIVE-UNBLOCK.md`,
   etc.), each required to open with a blockquote banner in its first 12
   lines identifying it as historical.

`docs/README.md` also states an **authority order** for resolving conflicting
claims: (1) a fresh production probe, (2) current `master` source/migrations/
executable tests, (3) git history, (4) `HANDOFF.md`'s top block, (5)
`ROADMAP.md`, (6) historical docs for rationale only. `planned`,
`implemented`, `merged`, `deployed`, and `live-accepted` are treated as
distinct, non-interchangeable states.

**`HANDOFF.md` is the current-state authority and nothing else** — kept
under a hard 200-line ceiling enforced by
`test/docs-contract.test.js:95-103` (it was 1666 lines once, with the live
claim buried; a test now prevents recurrence). Its historical tail lives in
`HANDOFF-HISTORY.md`. After any merge, deployment, rollback, or live
acceptance, update the top block of `HANDOFF.md` in the same close-out
change — never convert a roadmap intention into a shipped claim without
source evidence, never convert a source claim into a live claim without a
production probe.

**Evidence labeling is mandatory prose convention, not code.** Every
non-trivial claim in `HANDOFF.md` (and by extension, PR descriptions and
close-out comments) is tagged with exactly one of: **git-proven**
(commit/merge state), **test-proven** (a named test suite passed),
**live-proven** (a fresh probe against the running Cloud Run service),
**historical acceptance evidence** (a past live check, now stale), or
**unverified**. Example from `docs/HANDOFF.md:21-24`: "`npm run verify`
passes 385 backend tests and 107 frontend tests" is test-proven; "Cloud Run
revision `agent-canvas-00057-47c` serves 100% of traffic" is live-proven and
explicitly timestamped, because "live evidence is an observation at one
instant, not a permanent property" (`docs/HANDOFF.md:9-10`). Match this
labeling discipline in any status write-up for this subtree.

**"Lamps never fake green."** From `agent-canvas/CLAUDE.md:22`: every claim
must be verified against a tool result before being stated as fact — no
reporting a check as passing without having actually run it, no describing a
deploy as live without a fresh probe. This is the same rule as the global
"no completion claims without running the code" gate, restated as a house
rule specific to this subtree's history of status documents drifting from
reality.

**Read broadly, write reasonably, destroy never** (`agent-canvas/CLAUDE.md:22`)
— read surrounding context before editing, keep diffs proportionate to the
task, and treat destructive operations (deleting canvases, rows, history) as
requiring explicit operator intent, mirroring the root repo's git safety
protocol but applied to the app's own data model (see the "recoverable
tombstone" removal pattern for notes/files in `docs/HANDOFF.md:66-76`).

---

*Convention analysis: 2026-08-19*
