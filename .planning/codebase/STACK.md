# Technology Stack

**Analysis Date:** 2026-07-26

## Languages

**Primary:**
- JavaScript (CommonJS, `'use strict'` per file) - all of `src/`, `scripts/`, `test/`

**Secondary:**
- Bash - `scripts/engstatus.sh`, `scripts/setup-remote-trigger.sh`, `.claude/hooks/*.sh`
- XML (launchd plists) - `config/com.secondbrain.daily-sweep.plist`, `config/com.secondbrain.dream.plist`, `config/com.secondbrain.today.plist`

No TypeScript, no JSX. `.mcp.json` (repo root) registers one dev-tool MCP server (`context7`, Upstash docs lookup via `npx`) — unrelated to the project's own runtime.

## Runtime

**Environment:**
- Node.js `>=22` (`package.json:7` `engines.node`)
- Required for the `node:sqlite` built-in (`DatabaseSync`), used in `scripts/build-index.js` and its test

**Package Manager:**
- npm, `package-lock.json` committed
- No build/transpile step — `main` in `package.json` is `src/vault-gateway.js`, run directly by `node`

## Frameworks

**Testing:**
- Jest `30.3.0` - unit + integration + UAT. Config is inline in `package.json` (`jest.testPathIgnorePatterns`: `/node_modules/`, `.claude/worktrees`) — no separate `jest.config.js`
- `nock` `14.0.16` (dev) - HTTP mocking in tests

**Build/Dev:**
- ESLint `10.7.0` flat config at `eslint.config.js` - `@eslint/js` `10.0.1` recommended rules as base, layered with:
  - `eslint-plugin-n` `18.2.2` for `src/**/*.js` (Node-specific rules)
  - `eslint-plugin-jest` `29.15.5` for `test/**/*.js`
- `ajv` `8.20.0` (dev) - JSON Schema validation for every file in `config/`
- `license-checker` `25.0.1` - production-dependency license allowlist gate (`npm run license-check`)

## Key Dependencies

**Critical:**
- `@anthropic-ai/sdk` `^0.112.5` - Anthropic Haiku/Sonnet client, instantiated in `src/pipeline-infra.js`; used by the `/new` classifier, memory extraction, `/today` LLM augmentation, and dream consolidation
- `voyageai` `0.2.1` - **exact pin, no `^`**. Semantic embeddings client (`src/semantic-index.js`); pinned since the SDK's request/response shape is hand-parsed
- `chokidar` `^3.6.0` - config hot-reload file watching (`src/vault-gateway.js`, emits `config:reloaded`); pinned to 3.x because chokidar 4 dropped CJS `require()` support

**Infrastructure:**
- `gray-matter` `^4.0.3` - frontmatter/YAML parsing for vault notes
- `minisearch` `^7.2.0` - keyword search index backing `/recall` (non-semantic path)
- `dotenv` `^17.4.2` - `.env` loading

## Configuration

**Environment:**
- `.env` (gitignored) holds secrets; `.env.template` documents the expected shape: `VAULT_ROOT`, `PROJECTS_DIR`, `LM_API_TOKEN`
- `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` documented in `docs/DEVOPS-HANDOFF.md` but not in `.env.template` itself
- Test isolation env vars: `VAULT_ROOT`, `CONFIG_DIR_OVERRIDE`, `CACHE_DIR_OVERRIDE`, `LLM_PROVIDER`

**Build:**
- `config/*.json` — 10 tracked files; validation is schema-driven (`src/config-validator.js` walks `config/schema/*.schema.json`, not the config dir), so 9 config/schema pairs validate via AJV: connectors, docsync, excluded-terms, memory-categories, pipeline, reach-targets, scheduling, templates, vault-paths. Two deliberate gaps: `pipeline.local.example.json` has no schema and is unchecked, and `daily-stats-frontmatter.schema.json` validates frontmatter inside a vault file, so it emits a standing `[WARNING] config file not found`. `.local.json` overlays are gitignored (e.g. `config/pipeline.local.json`)
- `config/vault-paths.json` now defines vault structure post-restructure: LEFT = `ABOUT ME`, `Daily`, `Relationships`, `Drafts`; RIGHT = `memory`, `briefings`, `ctg`, `job-hunt`, `interview-prep`, `content`, `research`, `ideas`, `standups`, `projects`, `maps`, `proposals` (+ `proposals/unrouted`, `proposals/left-proposals`, `proposals/left-proposals/archive`), `archive`, `inbox` — the old flat `RIGHT/` folder is gone; briefings live under `briefings/`, and memory/proposal history lives under `archive/memory` and `archive/proposals` respectively
- `eslint.config.js` - flat config, no `.eslintrc*`
- No bundler, no transpiler, no `tsconfig.json`

## Platform Requirements

**Development:**
- macOS (Darwin) - launchd-based scheduling is macOS-specific; developed and run on the same machine
- Git hooks are repo-managed: `npm run prepare` sets `git config core.hooksPath hooks` (`pre-commit`: AJV config validation + vault boundary check; `pre-push`: stale-master guard + docs-sync gate; `post-merge`: non-blocking docs drift warning)

**Production:**
- No server process, no cloud hosting, no deployment target — runs on-demand via Claude Code CLI and on a schedule via macOS launchd

## CI (GitHub Actions — `.github/workflows/`)

- **`ci.yml`** - push/PR to `master`; Node `22` matrix; `npm ci` → `npm run lint` → `npx jest --coverage` with enforced thresholds (`branches:80, functions:90, lines:90, statements:90`) → license-check → `npm audit --audit-level=high`
- **`codeql.yml`** - CodeQL SAST for `javascript`; push/PR to `master` plus weekly cron
- **`uat.yml`** - UAT accuracy suite; `workflow_dispatch` + weekly cron; sets `CI=''` for the test step only
- **`claude-code-review.yml`** / **`claude.yml`** - automatic and mention-triggered Claude Code Action reviews
- GitGuardian secrets scanning is enforced externally (GitHub App / branch protection), not as an in-repo Action

## Notable Additions (PRs #90-93, merged 2026-07-26)

- `src/memory-dashboard.js` - new derived read surface, regenerated whole on every real promotion; renders `memory/dashboard.md` from `memory/memory.md` + proposals, with no pipeline bookkeeping (`content_hash`, block anchors) so it stays human-readable in Obsidian
- `src/daily-stats.js` - new `vault_hygiene` column tracked per daily-stats row (also consumed by `src/briefing-helpers.js` for prior-row comparison)
- `src/content-policy.js` - excluded-term matching is now whole-token (word-boundary-safe via lookarounds, not `\b`, to avoid matching inside longer tokens like "ma[in in]dex")
- `src/reach-exporter.js` - egress content-policy gate is fail-closed: stays closed on any throw during the exclusion check, not just on an explicit denial

---

*Stack analysis: 2026-07-26*
