# Codebase Structure

**Analysis Date:** 2026-08-18

This repository contains two independently-structured projects: the second-brain memory pipeline at the repo root, and the `agent-canvas/` subproject (its own `package.json`, test runner, deploy pipeline, and `CLAUDE.md`). See ARCHITECTURE.md for how they relate.

## Directory Layout — Repo Root (second-brain)

```
second-brain/
├── src/                     # Pipeline library modules (CJS, single-responsibility)
│   ├── today/               # /today orchestrator's extracted stages (Phase 15 refactor)
│   ├── connectors/          # External API connectors (calendar, gmail, github) + shared result-shape contract
│   └── utils/               # Cross-cutting utilities (health trackers, hashing, schema validation)
├── test/                    # Jest suite (58 files), mirrors src/ layout plus integration/uat/fixtures
│   ├── today/               # Tests for src/today/* stages
│   ├── uat/                 # End-to-end UAT tests, skip-gated from CI (process.env.CI && test.skip)
│   └── unit/, utils/        # Focused unit tests
├── config/                  # JSON config, optionally overlaid by gitignored *.local.json
│   └── schema/              # AJV JSON Schema definitions, one per config file
├── scripts/                 # Standalone CLI entry points (each loads dotenv itself)
├── hooks/                   # Repo-managed git hooks (core.hooksPath=hooks) + their JS implementations
├── .claude/
│   ├── hooks/                # Claude Code lifecycle hooks (SessionStart, Stop, gates)
│   ├── agents/               # Claude Code subagent definitions (test-runner, vault-guardian, canvas-*, etc.)
│   ├── commands/              # Slash command definitions (/today, /new, /wrap, /recall, /reroute, ...)
│   └── skills/                # Skill definitions (dream-propose, dream-apply, config-validator, pipeline-health)
├── .planning/                # GSD execution state (PROJECT.md, ROADMAP.md, milestones, codebase docs — this file)
├── decisions/                 # ADRs (ADR-018/019/020: reach layer, authority hierarchy)
├── docs/                      # Codebase map, DevOps handoff, program docs
├── eval/                      # Retrieval eval harness: frozen seed vault, golden recall set, baselines
├── content/                   # Static assets referenced by executive deliverables (PDFs, logos)
├── tasks/                     # lessons.md (operator-correction log) and related task tracking
├── agent-canvas/              # Separate subproject — see below
├── CLAUDE.md                  # Root project instructions
└── package.json                # Root Node project: Jest, ESLint flat config, root src/scripts/test
```

## Directory Purposes — Repo Root

**`src/`:**
- Purpose: single-responsibility CJS modules — vault gateway, memory extraction/staging/promotion, semantic index, connectors, orchestration
- Contains: ~30 top-level `.js` files plus `today/`, `connectors/`, `utils/` subdirectories
- Key files: `vault-gateway.js` (write enforcement), `today-command.js` (orchestrator), `memory-extractor.js`/`memory-proposals.js`/`promote-memories.js` (memory pipeline), `semantic-index.js` (Voyage embeddings + RRF), `reach-exporter.js` (cross-surface export), `classifier.js` (`/new` routing), `pipeline-infra.js` (config loaders, LLM client factory)

**`src/today/`:**
- Purpose: extracted stages of the `/today` briefing pipeline (post-Phase-15 refactor — `today-command.js` composes these rather than inlining logic)
- Key files: `slippage-scanner.js`, `frog-identifier.js`, `llm-augmentation.js`, `briefing-renderer.js`, `memory-health.js`, `compounding-trend.js`, `sweep-status.js`

**`src/connectors/`:**
- Purpose: external API integrations sharing one result-shape contract (`types.js`)
- Key files: `calendar.js`, `gmail.js`, `github.js` — each returns `{success, data, error, source, fetchedAt}`, never throws

**`src/utils/`:**
- Purpose: cross-cutting helpers not specific to one pipeline stage
- Key files: `voyage-health.js`/`classifier-health.js` (Pattern 7 adaptive denial trackers, persist to `~/.cache/second-brain/`), `memory-utils.js` (hashing), `validate-schema.js`

**`test/`:**
- Purpose: Jest suite, 58 files, structure mirrors `src/`
- Subdirs: `today/` (mirrors `src/today/`), `uat/` (end-to-end, CI-skip-gated), `unit/` (focused single-function tests), `utils/`
- Convention: `<module>.test.js` co-located by name with its `src/` counterpart, not by directory nesting (e.g. `test/vault-gateway.test.js` for `src/vault-gateway.js`)

**`config/`:**
- Purpose: JSON configuration, hot-reloadable where the consuming module watches it (`vault-gateway.js` watches `vault-paths.json` and `excluded-terms.json` via chokidar)
- Key files: `vault-paths.json` (LEFT/RIGHT allowlist), `excluded-terms.json` (content-policy exclusions), `pipeline.json`/`pipeline.local.example.json` (LLM client config, overlay pattern), `reach-targets.json` (cross-surface export allowlist), `memory-categories.json`, `scheduling.json`, `connectors.json`, `docsync.json`, `templates.json`
- `config/schema/`: one AJV JSON Schema per config file, validated by `src/config-validator.js` and the `pre-commit` hook

**`scripts/`:**
- Purpose: standalone CLI entry points, each independently `require`-able and each loading its own dotenv
- Key files: `wrap.js` (`/wrap` backing script), `daily-sweep.js` (nightly inbox+transcript mining), `today-scheduled.js` (launchd entry for `/today`), `dream.js` (monthly consolidation propose/apply), `recall.js` (cross-session recall CLI), `compounding-report.js`, `verify-baseline.js`, `build-index.js`, `validate-archive.js`, `migrate-memory-wiki.js`, `setup-remote-trigger.sh`, `engstatus.sh`

**`hooks/`:**
- Purpose: git hooks, live at `core.hooksPath=hooks` (repo-managed, not `.git/hooks/`)
- Key files: `pre-commit`/`pre-commit-schema-validate.js`/`pre-commit-vault-boundary.js` (AJV validation + LEFT/RIGHT boundary check), `pre-push`/`pre-push-docsync.js` (stale-master block + docs-sync gate, `SKIP_DOCSYNC=1` bypass), `post-merge`/`post-merge-doc-sync.js` (non-blocking drift warning)

**`.claude/`:**
- Purpose: Claude Code configuration — separate from git hooks
- `hooks/`: `auto-test.sh`, `protected-file-guard.sh`, `security-scan-gate.sh`/`.md`, `memory-extraction-hook.js`, `session-memory-inject.js`, `staleness-check.js`
- `agents/`: subagent definitions, including two agent-canvas-specific ones — `canvas-integration-auditor.md`, `canvas-tool-surface-reviewer.md` — alongside the root-focused `vault-guardian.md`, `memory-specialist.md`, `pipeline-reviewer.md`, `test-runner.md`, `test-verifier.md`, `security-scanner.md`, `docs-sync.md`, `vault-triage.md`
- `commands/`: one `.md` file per slash command
- `skills/`: `dream-propose/`, `dream-apply/`, `dream-memory-consolidation/`, `config-validator/`, `pipeline-health/`

**`.planning/`:**
- Purpose: GSD execution state — this file lives at `.planning/codebase/STRUCTURE.md`
- Key subdirs: `codebase/` (this doc set), `milestones/` (per-version requirements/roadmap/phase docs), `debug/`, `quick/` (ad-hoc task logs), `reports/`, `dependencies/`, `research/`

**`eval/`:**
- Purpose: retrieval quality regression harness
- Contains: `seed-vault/` (frozen test vault), `golden-recall.json` (labeled query set), `baseline-*.json` (recorded recall@5/MRR baselines)
- Run via `npm run eval:recall`; exits 1 on regression

**`decisions/`:**
- Purpose: architecture decision records
- Key files: `ADR-018-cross-surface-reach.md`, `ADR-019-reach-layer-mechanism.md`, `ADR-020-authority-hierarchy.md`

## Naming Conventions — Root

**Files:** camelCase module names matching their primary export's domain (`vault-gateway.js`, `memory-proposals.js`); hyphenated multi-word names throughout `src/` and `scripts/`.

**Tests:** `<module-name>.test.js`, placed in `test/` at the same relative depth as the `src/` file it covers (or in `test/unit/`, `test/uat/`, `test/today/` when the test is integration/e2e/stage-specific rather than a 1:1 unit mirror).

**Config:** `<domain>.json` at `config/` root, paired with `config/schema/<domain>.schema.json`; local overrides as `<domain>.local.json` (gitignored).

## Where to Add New Code — Root

**New pipeline stage or module:** `src/<name>.js`, paired with `test/<name>.test.js`. If it's a `/today` stage specifically, add to `src/today/` and wire it into `today-command.js`'s composition.

**New external connector:** `src/connectors/<service>.js`, implementing the shared `{success, data, error, source, fetchedAt}` contract from `src/connectors/types.js`; never throws.

**New config file:** add `config/<name>.json` + `config/schema/<name>.schema.json`; load via `pipeline-infra.js`'s overlay-enabled loader pattern, not a raw `fs.readFileSync`.

**New slash command:** `.claude/commands/<name>.md` plus a backing module in `src/` or script in `scripts/`.

**New health/degradation tracker:** follow Pattern 7 (`src/utils/voyage-health.js`) — persist consecutive-failure state to `~/.cache/second-brain/<name>.json`.

---

## Directory Layout — `agent-canvas/`

```
agent-canvas/
├── server/                  # Express backend — the entire runtime
│   ├── orchestrator/         # Agent run engine: runner, queue, control, tools, model adapters
│   ├── mcp/                   # Generic MCP connector client + server seeding
│   ├── enrichment/             # Read-only enrichment-dispatch fan-out client
│   ├── hubspot/                 # Sole HubSpot write lane (ops-runner proxy)
│   ├── google/                   # Gmail/Drive/Sheets/Calendar client (grantor OAuth)
│   ├── config/                    # Static JSON config: ICP definitions, legacy prompts, org context, supplier catalog
│   ├── routes.js                    # Single Express router — ~100 endpoints (2,532 lines)
│   ├── db.js                          # SQLite schema + connection (node:sqlite, WAL)
│   ├── memory.js                        # Shared project memory (append-only, epistemic states)
│   ├── auth.js                            # Session auth, OAuth login, role checks
│   ├── ws.js / bus.js                      # WebSocket hub / in-process event bus
│   ├── standing-rules.js                    # Scheduled-rule parsing, leasing, dispatch
│   ├── roster.js, builder.js, rooms.js       # Agent lifecycle, agent-draft propose/publish, rooms feature
│   ├── evidence.js, explain.js, attention.js  # Evidence tagging, run explain-map, escalation/attention feed
│   ├── audit.js                                # Hash-chained audit log
│   ├── seed.js                                  # Boot-time DB seeding
│   ├── gcp-identity.js, probestate.js, ratelimit.js  # Keyless GCP identity tokens, health probe cache, rate limiting
│   └── index.js                                       # App assembly + process entry point
├── frontend/                # Vite + React SPA
│   ├── src/                  # FLAT — 22 files, no nested component directories
│   ├── test/                  # Vitest suite (.test.jsx)
│   └── public/                 # Static assets (README, mascot.png)
├── test/                    # Backend test suite — node:test, 47 files
│   └── fixtures/             # Test fixtures (e.g. fake-stdio-mcp.js)
├── deploy/                  # Deployment scripts + vendored CA bundle
├── docs/                    # Agent-canvas's own doc set — authoritative for current state
├── hubspot-mcp-bridge/      # Standalone MCP bridge service (own Dockerfile/deploy.sh)
├── gtm-mcp-bridge/          # Standalone MCP bridge service (own Dockerfile/deploy.sh)
├── scripts/                 # Registry/prompt build scripts (build-registries.js, snapshot-roster-prompts.js)
├── Dockerfile               # Node 22-slim + vendored Litestream .deb + CA bundle
├── cloudbuild.yaml           # Cloud Build config
├── package.json               # Separate Node project: express, ws, @anthropic-ai/sdk, @google/genai, pdfjs-dist
└── CLAUDE.md                    # Agent-canvas project instructions (layered on root CLAUDE.md)
```

## Directory Purposes — `agent-canvas/`

**`server/`:**
- Purpose: the entire backend runtime — one Express app, no separate services within the main deployable
- Contains: 27 top-level files/dirs; the two largest are `routes.js` (2,532 lines) and `tools.js` (1,295 lines, inside `orchestrator/`)

**`server/orchestrator/`:**
- Purpose: the agent run engine
- Key files: `runner.js` (the run loop — system prompt construction, model calls, tool execution, budget enforcement), `queue.js` (dispatch, bounded concurrency, stranded-run reconciliation, orphan recovery), `tools.js` (tool definitions, authority/mode gating, escalation creation), `control.js` (global pause, daily budget), `anthropic.js`/`gemini.js` (provider adapters), `pdf-extract-worker.js` (PDF text extraction worker)

**`server/mcp/`:**
- Purpose: generic Model Context Protocol connector layer
- Key files: `client.js` (Streamable-HTTP JSON-RPC client, per-tool allowlisting, mutating-tool-name heuristic), `seed.js` (boot-time MCP server seeding from config)

**`server/enrichment/`:**
- Purpose: read-only client for the external `ctg-enrichment-dispatch` service
- Key file: `dispatch.js` — no commit tool by design, per-call credit clamping

**`server/hubspot/`:**
- Purpose: the sole HubSpot write lane
- Key file: `opsrunner.js` — proxies to external IAM-gated ops-runner, no local HubSpot credential, client-side refusal-list mirror

**`server/google/`:**
- Purpose: Gmail/Drive/Sheets/Calendar access on behalf of the connecting user (not a service account)
- Key file: `workspace.js`

**`server/config/`:**
- Purpose: static JSON reference data consumed by the roster/builder/standing-rules modules
- Key files: `icp-sr-icp-v6.json`, `legacy-exec-prompts.json`, `legacy-roster-prompts.json`, `org-context.json`, `supplier-catalog.json`

**`frontend/src/`:**
- Purpose: the entire React SPA — flat, no `components/`, `pages/`, or `hooks/` subdirectories
- Contains: 22 files — `App.jsx` (root), `Canvas.jsx`, `Nodes.jsx`, `Panels.jsx`, `Workspace.jsx`, `Home.jsx`, `RoomsView.jsx`, `RulesView.jsx`, `NeedsYouView.jsx` (top-level views); `AgentBuilder.jsx`, `AddAgentModal.jsx`, `AdminModal.jsx`, `CapabilitiesModal.jsx`, `CommandBar.jsx`, `ActivityDock.jsx`, `MemoryPanel.jsx`, `ExplainMap.jsx`, `Tray.jsx` (feature panels/modals); `api.js`, `format.jsx`, `teamTemplates.js`, `useDialog.js`, `main.jsx`, `styles.css` (shared utilities/entry)

**`test/` (backend):**
- Purpose: `node:test`-based suite, 47 files, one file per feature area rather than mirroring `server/` 1:1
- Key files: `hardening.test.js`, `orchestrator-safety.test.js`, `access-control.test.js`, `hubspot-opsrunner.test.js`, `enrichment-dispatch.test.js`, `memory-contract.test.js`, `memory-lifecycle.test.js`, `standing-rules.test.js`/`standing-rules-tick.test.js`, `roster-heal.test.js`/`roster-reseed.test.js`, `mcp-connectors.test.js`/`mcp-access.test.js`

**`frontend/test/`:**
- Purpose: Vitest suite for the React app, `.test.jsx` naming
- Key files: `workspace-cleanup.test.jsx`, `builder.test.jsx`, `rules.test.jsx`, `rooms.test.jsx`, `light-theme.test.jsx`, `api-upload.test.jsx`, `setup.js` (test environment setup)

**`deploy/`:**
- Purpose: deployment tooling for the Cloud Run service
- Key files: `deploy.sh` (main deploy script, includes a `--selftest` preflight mode invoked by `npm run verify`), `start.sh` (container entrypoint — Litestream restore-then-replicate wrapping `node server/index.js`), `cacert.pem` (vendored Mozilla CA bundle for Litestream→GCS TLS on `node:22-slim`, which ships no system CA store)

**`docs/`:**
- Purpose: agent-canvas's own authoritative doc set — separate from and more current than anything in root `.planning/` for agent-canvas specifics
- Key files: `HANDOFF.md` (current-state block, authoritative), `HANDOFF-HISTORY.md` (superseded tail of HANDOFF.md), `ROADMAP.md`, `DEPLOY.md`, `DEVOPS-HANDOFF.md`, `AUTONOMOUS-EXECUTION.md`, `FRONTEND-SPEC.md`, `HUBSPOT-AGENT-CLI.md`, `IMPROVE-FINDINGS.md`, `PORTFOLIO-FOLD-IN.md`, `WAVE2-SOI-RUNBOOK.md`, `GO-LIVE-UNBLOCK.md`, `README.md` (classifies current/reference/historical — read first)

**`hubspot-mcp-bridge/`, `gtm-mcp-bridge/`:**
- Purpose: standalone MCP bridge services, each independently deployed (own `Dockerfile`, `deploy.sh`) — not started by `server/index.js` and not part of the main Cloud Run service

**`scripts/`:**
- Purpose: build-time tooling for the roster/registry system, not runtime
- Key files: `build-registries.js`, `snapshot-roster-prompts.js`

## Naming Conventions — `agent-canvas/`

**Backend files:** lowercase, single-word-or-hyphenated module names matching domain (`routes.js`, `standing-rules.js`, `probestate.js`).

**Frontend files:** PascalCase for React components (`AgentBuilder.jsx`, `RoomsView.jsx`), camelCase for non-component modules (`api.js`, `format.jsx`, `useDialog.js`).

**Tests (backend):** `<feature-area>.test.js` under `test/`, `node:test` runner — feature-scoped, not 1:1 with `server/` files.

**Tests (frontend):** `<feature>.test.jsx` under `frontend/test/`, Vitest.

## Where to Add New Code — `agent-canvas/`

**New API endpoint:** add a route in `server/routes.js`; if it needs non-trivial logic, put that logic in a new or existing `server/<domain>.js` module and keep the route handler thin (existing pattern: `memory.js`, `standing-rules.js`, `rooms.js`).

**New orchestrator tool:** `server/orchestrator/tools.js` — register the tool definition, wire mode-blocking and authority checks; if it calls an external service, add a dedicated client module (follow the `hubspot/opsrunner.js` / `enrichment/dispatch.js` pattern: named operations only, keyless identity token, client-side refusal mirror if the external service has one, every call audited).

**New external integration:** a new top-level `server/<service>/` directory with its own client module — do not add raw `fetch` calls inline in `routes.js` or `tools.js`.

**New frontend view/panel:** a new file directly in `frontend/src/` (flat convention — do not introduce a `components/` subdirectory unless restructuring is explicitly planned).

**New backend test:** `test/<feature-area>.test.js`, `node:test` style (see `hardening.test.js` for the house style).

**New frontend test:** `frontend/test/<feature>.test.jsx`, Vitest + existing `setup.js`.

**Verification gate before any agent-canvas change is done:** `npm run verify` (backend `node:test` + frontend vitest + frontend production build + `deploy.sh` syntax + deploy preflight self-test) — `npm test` alone only covers the backend and has never been the full gate.

---

*Structure analysis: 2026-08-18*
