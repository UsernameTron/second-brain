# Technology Stack

**Analysis Date:** 2026-08-19

This repo hosts two independently-versioned Node projects: the **second-brain
pipeline** at the repo root, and the **agent-canvas** subproject at
`agent-canvas/` (its own git history point, deployed to GCP project
`agent-canvas-ctg-0811`). Each has its own `package.json`, test runner, and
deploy story. `agent-canvas/frontend/` is a third, Vite-based package.

---

## 1. second-brain pipeline (repo root)

### Languages
- JavaScript (CommonJS) — all of `src/`, `scripts/`, `test/`. No TypeScript, no build/transpile step.

### Runtime
- Node.js **>=22** (`package.json` `engines.node`), required specifically for the `node:sqlite` built-in used elsewhere in the estate.
- Package manager: npm, lockfile present (`package-lock.json`).

### Frameworks / Test Tooling
- **Jest 30** (`jest --verbose`) — unit + integration tests in `test/`, UAT subset in `test/uat/` gated by `CI` env skip-logic (`npm run test:uat` unsets `CI`, `test:uat:ci` doesn't).
- **ESLint 10** flat config (`eslint.config.*`) over `src/` and `test/`, plugins `eslint-plugin-jest`, `eslint-plugin-n`.
- **license-checker** — production dependency license allowlist (`MIT;ISC;Apache-2.0;BSD-2-Clause;BSD-3-Clause;CC0-1.0;Unlicense`).
- No bundler/build step — plain CJS `require`, run directly with `node`.

### Key Dependencies (`package.json`)
- `@anthropic-ai/sdk` ^0.112.5 — Haiku/Sonnet classification, extraction, content-policy guard (`src/content-policy.js`, `src/pipeline-infra.js`).
- `voyageai` 0.2.1 (exact pin) — semantic embeddings (`src/semantic-index.js`).
- `chokidar` ^3.6.0 — filesystem watching (CJS-compatible pin; v4 is ESM-only).
- `gray-matter` ^4.0.3 — markdown frontmatter parsing for vault notes.
- `dotenv` ^17.4.2 — `.env` loading.
- `minisearch` ^7.2.0 — keyword search index for `/recall`.
- Dev-only: `ajv` ^8.18.0 (config schema validation), `nock` ^14.0.13 (HTTP mocking in tests).

### Configuration
- `config/*.json` + optional `config/*.local.json` overlay (gitignored), validated against `config/schema/` via AJV.
- `config/pipeline.json` — classifier thresholds, extraction/promotion tuning, LLM provider config.
- `config/pipeline.local.json` — machine-local overlay: switches `classifier.llm.provider` to `local` (LM Studio) with `localModel: "qwen/qwen3.6-27b"`, `localTimeoutMs: 900000`.
- Git hooks are repo-managed via `npm run prepare` (`core.hooksPath=hooks`, not `.git/hooks/`): `pre-commit` (AJV + vault boundary check), `pre-push` (staleness + docs-sync gate), `post-merge` (non-blocking docs-drift warning).

### Platform Requirements
- **Development:** macOS (this machine), Obsidian 1.7+ with the Local REST API plugin running, LM Studio for local-model fallback.
- **Production/runtime:** no server deploy — runs as local Node processes invoked by Claude Code slash commands and macOS `launchd` (see INTEGRATIONS.md).

---

## 2. agent-canvas backend (`agent-canvas/`)

### Languages
- JavaScript (CommonJS), Node's built-in `node:test` runner for tests (not Jest).

### Runtime
- Node.js **>=22.5** (`agent-canvas/package.json` `engines.node`).
- Package manager: npm, lockfile present.

### Frameworks
- **Express** ^4.21.2 — HTTP API (`server/index.js`, `server/routes.js`).
- **ws** ^8.18.0 — WebSocket transport for live canvas state (`server/ws.js`).
- **express-rate-limit** ^8.6.2 — request throttling (`server/ratelimit.js`).
- Data layer: **`node:sqlite`** (Node's built-in `DatabaseSync`, not `better-sqlite3`) — `server/db.js`, WAL mode, `busy_timeout=5000`, foreign keys on. Memory rows are append-only (no UPDATE/DELETE; corrections stamp `superseded_by`).
- **Litestream** v0.3.13 (installed via `.deb` in the Docker image, not an npm package) — continuous SQLite replication to GCS when `LITESTREAM_REPLICA_URL` is set; restores on cold boot.

### Test Tooling
- `node --test "test/*.test.js"` (`npm test`) — backend suite, ~50 files under `agent-canvas/test/`.
- `npm run test:frontend` — delegates to the Vite/Vitest frontend suite.
- `npm run verify` — the actual merge gate: backend tests + frontend tests + frontend production build + `deploy.sh` bash syntax check (`bash -n`) + deploy preflight self-test (`deploy/deploy.sh --selftest`). `npm test` alone is **not** the gate (per `agent-canvas/CLAUDE.md`).
- `playwright` ^1.62.1 (devDependency) — browser-driven checks.

### Key Dependencies
- `@anthropic-ai/sdk` ^0.112.0 — Anthropic first-party model calls.
- `@anthropic-ai/vertex-sdk` ^0.19.1 — Claude served via Google Vertex AI (default provider path).
- `@google/genai` ^2.16.0 — Gemini provider path (`server/orchestrator/gemini.js`).
- `google-auth-library` ^11.0.1 — OAuth2Client for Google sign-in (`server/auth.js`) and Workspace token handling (`server/google/workspace.js`).
- `jsonwebtoken` ^9.0.2 — session cookies (`ac_session`, 7-day TTL).
- `exceljs` 4.4.0, `mammoth` 1.12.1, `pdfjs-dist` 5.4.296 — document intake/parsing (xlsx, docx, pdf) for canvas document enrichment.
- `overrides.uuid` pinned to ^11.1.1 (transitive dependency pin).

### Model routing (`server/orchestrator/anthropic.js`)
- `MODEL_PROVIDER` env selects the door: `vertex` (default, keyless via runtime service account ADC), `anthropic` (first-party API key or OAuth), or `gemini`.
- Fast tier: `claude-haiku-4-5`; strong tier: `claude-sonnet-5` (env-overridable `FAST_MODEL`/`STRONG_MODEL`); Gemini tier models `gemini-2.5-flash`/`gemini-2.5-pro`; refusal-fallback `claude-opus-4-8`.

### Build / Deploy Tooling
- **Docker** multi-stage build (`agent-canvas/Dockerfile`): stage 1 builds the frontend (`npm run build` under Vite), stage 2 installs server deps (`npm ci --omit=dev`), stage 3 assembles the runtime image on `node:22-slim`, installs the Litestream `.deb`, vendors a Mozilla CA bundle (`deploy/cacert.pem`), runs as non-root `appuser` (uid 1001).
- **Cloud Build** (`cloudbuild.yaml`) — single Docker build step with `DOCKER_BUILDKIT=1` (required for the Dockerfile's `RUN --mount=type=secret` build_ca hook).
- **`deploy/deploy.sh`** — idempotent one-command Cloud Run deploy; provisions project/APIs/billing/Artifact Registry/GCS bucket/service accounts/secrets, reads the *live* service config before mutating it (preservation-first: env vars/secrets applied additively, `MODEL_PROVIDER` inherited unless explicitly changed with `DEPLOY_PROVIDER_CHANGE=1`), has a `--selftest` mode and `DEPLOY_DRY_RUN=1`.
- Cloud Run: `--max-instances 1` (SQLite is single-writer), `--memory 1Gi --cpu 1`, `--allow-unauthenticated` at the transport layer (app-level auth enforces the allowlist — see INTEGRATIONS.md).

---

## 3. agent-canvas frontend (`agent-canvas/frontend/`)

### Languages
- JavaScript (JSX), ES modules (`"type": "module"`).

### Frameworks
- **React** ^18.3.1 / **react-dom** ^18.3.1.
- **Vite** ^6.4.3 — dev server and production build (`vite build` → `frontend/dist`, copied into the backend Docker image).
- `@vitejs/plugin-react` ^4.3.1.

### Test Tooling
- **Vitest** ^4.1.10 (`vitest run`) with **jsdom** ^29.1.1 environment.
- `@testing-library/react` ^16.3.2, `@testing-library/jest-dom` ^7.0.1, `@testing-library/user-event` ^14.6.4.

### Configuration
- `frontend/vite.config.js` — build/dev server config.
- No TypeScript — plain `.jsx`/`.js`.

---

## 4. MCP bridge sidecars (`agent-canvas/hubspot-mcp-bridge/`, `agent-canvas/gtm-mcp-bridge/`)

Each is a standalone single-file Node HTTP server, deployed as its **own**
Cloud Run service (separate `Dockerfile` + `deploy.sh`), independent of the
main agent-canvas backend's npm workspace.

### hubspot-mcp-bridge
- `node:22-slim` base image, no dependency install for the bridge itself — installs `@hubspot/mcp-server@0.4.0` globally in the image (`npm install -g @hubspot/mcp-server@0.4.0`, version pinned deliberately).
- Runtime: plain `node:http`, `node:child_process` (`spawn`) — no Express, no MCP SDK by design ("ponytail: raw JSON-RPC pass-through" — the canvas client only sends `initialize`/`tools/list`/`tools/call`).
- Bridges Streamable-HTTP (Cloud Run) to the child MCP server's newline-delimited stdio JSON-RPC.

### gtm-mcp-bridge
- `node:22-slim` base image, zero npm dependencies at all — `node:http` + native `fetch` only.
- Implements a fixed, hardcoded set of 4 MCP tools that run 4 named BigQuery SQL queries (via BigQuery REST `jobs.query`, not the BigQuery Node SDK) against `ctg-hs-exec-tool:ctg_gtm_marts`.

---

## Cross-Cutting Notes

- **Two separate git-ignored/CI surfaces**: root `package.json` test config explicitly ignores `/agent-canvas/` (`jest.testPathIgnorePatterns`), so the two projects' test suites never collide.
- **No shared node_modules** — root, `agent-canvas/`, and `agent-canvas/frontend/` each have their own `package-lock.json` and dependency tree.
- **No TypeScript anywhere** in this repo tree (root pipeline, agent-canvas backend, or frontend) as of this analysis.

---

*Stack analysis: 2026-08-19*
