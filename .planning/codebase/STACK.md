# Technology Stack

**Analysis Date:** 2026-07-21

## Languages

**Primary:**
- JavaScript (CommonJS, `'use strict'` per file) - all of `src/`, `scripts/`, `test/`

**Secondary:**
- Bash - `scripts/engstatus.sh`, `scripts/setup-remote-trigger.sh`, `.claude/hooks/*.sh` (auto-test, protected-file-guard, security-scan-gate)
- XML (launchd plists) - `config/com.secondbrain.daily-sweep.plist`, `config/com.secondbrain.dream.plist`

No TypeScript, no JSX. `.mcp.json` (repo root) registers one dev-tool MCP server (`context7`, Upstash docs lookup via `npx`) — unrelated to the project's own runtime.

## Runtime

**Environment:**
- Node.js `>=22` (`package.json:7` `engines.node`), pinned in `.nvmrc` (`22`)
- Required specifically for the `node:sqlite` built-in (`DatabaseSync`), used in `scripts/build-index.js:26` and `test/build-index.test.js:12` — this is the hard floor, not a general LTS preference

**Package Manager:**
- npm, `package-lock.json` committed (241 KB)
- No build/transpile step — `main` in `package.json` is `src/vault-gateway.js`, run directly by `node`

## Frameworks

**Testing:**
- Jest `30.3.0` - unit + integration + UAT. Config is inline in `package.json` (`jest.testPathIgnorePatterns`: `/node_modules/`, `.claude/worktrees`) — no separate `jest.config.js`
- `nock` `14.0.13` (dev) - HTTP mocking in tests

**Build/Dev:**
- ESLint `10.2.1` flat config at `eslint.config.js` - `@eslint/js` `10.0.1` recommended rules as base, layered with:
  - `eslint-plugin-n` `17.24.0` for `src/**/*.js` (Node-specific rules)
  - `eslint-plugin-jest` `29.15.2` for `test/**/*.js`
  - Shared rules both layers enforce: `no-unused-vars` (with `^_` ignore pattern), `no-console: warn` (off in tests), `prefer-const: error`, `eqeqeq: error`
- `ajv` `8.18.0` (dev) - JSON Schema validation for every file in `config/`, schemas in `config/schema/`
- `license-checker` `25.0.1` - production-dependency license allowlist gate (`npm run license-check` → `--onlyAllow 'MIT;ISC;Apache-2.0;BSD-2-Clause;BSD-3-Clause;CC0-1.0'`)

## Key Dependencies

Versions below are resolved from `package-lock.json`; the `^` range is from `package.json`.

**Critical:**
- `@anthropic-ai/sdk` `^0.91.1` (resolved `0.91.1`) - Anthropic Haiku/Sonnet client, instantiated in `src/pipeline-infra.js` (`new Anthropic()`); used by the `/new` classifier, memory extraction, `/today` LLM augmentation, and dream consolidation
- `voyageai` `0.2.1` - **exact pin, no `^`**. Phase 19 semantic embeddings client (`src/semantic-index.js`). Per `.planning/milestones/v1.4-phases/19-semantic-memory-search/19-CONTEXT.md:19` (D-PRE-01), pinned to lock the SDK's request/response shape since `semantic-index.js` hand-parses embedding output — a minor-version shape change would silently corrupt the embeddings cache rather than fail loudly
- `chokidar` `^3.6.0` (resolved `3.6.0`) - config hot-reload file watching (`src/vault-gateway.js`, emits `config:reloaded`). Pinned to the 3.x line because chokidar 4 dropped CJS `require()` support (ESM-only); this project has no build step, so an ESM-only watcher would break every `require('chokidar')` call outright

**Infrastructure:**
- `gray-matter` `^4.0.3` (resolved `4.0.3`) - frontmatter/YAML parsing for vault notes
- `minisearch` `^7.2.0` (resolved `7.2.0`) - keyword search index backing `/recall` (non-semantic path)
- `dotenv` `^17.4.2` (resolved `17.4.2`) - `.env` loading

## Configuration

**Environment:**
- `.env` (gitignored) holds secrets; `.env.template` documents the expected shape: `VAULT_ROOT`, `PROJECTS_DIR`, `LM_API_TOKEN` (LM Studio bearer token)
- `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` are documented in `docs/DEVOPS-HANDOFF.md:36-39` but not in `.env.template` itself
- Test isolation env vars: `VAULT_ROOT`, `CONFIG_DIR_OVERRIDE`, `CACHE_DIR_OVERRIDE`, `LLM_PROVIDER`

**Build:**
- `config/*.json` (11 files) validated against `config/schema/*.json` via AJV at load time; `.local.json` overlays supported (e.g. `config/pipeline.local.json`, `config/pipeline.local.example.json` as the committed template)
- `eslint.config.js` - flat config, no `.eslintrc*`
- No bundler, no transpiler, no `tsconfig.json`

## Platform Requirements

**Development:**
- macOS (Darwin) - launchd-based scheduling (see INTEGRATIONS.md) is macOS-specific; developed and run on the same machine
- Git hooks are repo-managed: `npm run prepare` sets `git config core.hooksPath hooks`, so `hooks/` (not `.git/hooks/`) is live (`pre-commit`: AJV config validation + vault boundary check; `pre-push`: stale-master guard + docs-sync gate; `post-merge`: non-blocking docs drift warning)

**Production:**
- No server process, no cloud hosting, no deployment target — runs on-demand via Claude Code CLI and on a schedule via macOS launchd (`docs/DEVOPS-HANDOFF.md:5`)

## CI (GitHub Actions — `.github/workflows/`)

- **`ci.yml`** - push/PR to `master`; Node `22` matrix (`actions/setup-node@v4`); `npm ci` → `npm run lint` → `npx jest --coverage` with enforced thresholds (`branches:80, functions:90, lines:90, statements:90`, ratcheted from 70 in Phase 16) → coverage artifact upload (14-day retention) → `npm run license-check` → `npm audit --audit-level=high`
- **`codeql.yml`** - CodeQL SAST for `javascript`; push/PR to `master` plus a weekly Monday 06:00 UTC cron
- **`uat.yml`** - UAT accuracy suite; `workflow_dispatch` + weekly Monday 13:00 UTC cron; sets `CI=''` for the test step only so the `test/uat/*.test.js` skip guard (`process.env.CI === 'true'`) doesn't trip while every other step keeps GitHub's default `CI=true`; uploads report artifact (90-day retention)
- **`claude-code-review.yml`** - automatic Claude Code review on PR open/sync/reopen, skips bot-authored PRs (dependabot) since `claude-code-action` refuses non-human actors
- **`claude.yml`** - `@claude`-mention-triggered Claude Code Action on issue/PR comments and reviews
- **GitGuardian secrets scanning** is documented as a CI gate (`README.md:121,138`, `docs/DEVOPS-HANDOFF.md:172`) but has **no workflow file** in `.github/workflows/` — it is enforced externally (GitHub App / branch protection), not as an in-repo Action

---

*Stack analysis: 2026-07-21*
