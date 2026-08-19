# Architecture

**Analysis Date:** 2026-08-19

This repository hosts two independently-architected systems that share a git history and top-level directory but nothing at runtime: the **second-brain memory pipeline** (root `src/`, `scripts/`, `config/`, `hooks/`) and **agent-canvas** (`agent-canvas/`), a multi-agent workspace product for cloudtechgurus.com. See "How the two systems cohabit" at the end of this document.

---

## System A: Second-Brain Memory Pipeline

### Pattern Overview

**Overall:** Config-driven pipeline architecture over a single markdown vault substrate (Obsidian, `~/Claude Cowork/`). There is no server process — plain Node.js CJS modules in `src/` are invoked by Claude Code slash commands (`.claude/commands/*.md`), standalone CLI scripts (`scripts/*.js`), and macOS `launchd` schedules. Every workflow is a sequential pipeline with explicit fail-open/fail-closed gates rather than a request/response service.

**Key characteristics:**
- **Single write-enforcement choke point.** All vault mutations route through `src/vault-gateway.js`'s three sequential guards: Guard 1 path allowlist (`checkPath()`, `normalizePath()`), Guard 2 content filter (`src/content-policy.js`: keyword scan + Haiku classification + paragraph-level sanitization), Guard 3 style lint (`src/style-policy.js`: banned-word regex with attempt-count escalation). No module writes to the vault directly except the narrow atomic path `vaultWriteAtomic()` used by `daily-stats.js`.
- **LEFT/RIGHT write-permission boundary**, not a content-type split. `config/vault-paths.json` defines `left` (human voice, read-only to agents) and `right` (agent-writable) top-level vault folders; `validateConfig()` enforces `LEFT ∩ RIGHT = ∅`. `vaultRead()` implements a three-tier model: LEFT read-OK, RIGHT read-OK, unknown-path BLOCKED entirely (D-04).
- **Redacted quarantine.** Content blocked by any guard never reaches disk in its original form — `quarantine()` writes a metadata-only record (`proposals/quarantine-*.md`: reason, original path, timestamp) with the body withheld.
- **Never-throw LLM client contract.** `src/pipeline-infra.js`'s `createLlmClient()`/`createHaikuClient()` wraps every Anthropic/local-LLM call so failures surface as `{success:false, failureMode}` data, never exceptions — callers branch on the result.
- **Lease locks reclaimed on proven death, not age alone.** `src/memory-proposals.js`'s `acquireLock()` records `process.pid` in `proposals.lock`; a stale-by-age lock is only reclaimed after `process.kill(pid, 0)` proves the holder is dead (`ESRCH`).
- **Adaptive-denial health tracking (Pattern 7).** `src/utils/voyage-health.js` and `src/utils/classifier-health.js` persist consecutive-failure counts to `~/.cache/second-brain/*.json` so independent invocations coordinate on a known-bad endpoint.
- **Non-fatal side channels.** Embedding, reach export, SQLite rebuild, dashboard regeneration, contradiction-flagging, and stats recording each wrap their own try/catch around the primary write — a side-channel failure never breaks "briefing-is-the-product" or "promotion-is-the-product".
- **Human-in-the-loop gates via checkbox parsing.** Memory-promotion and dream-consolidation stage proposals as markdown with `- [ ] accept/reject` checkboxes, parsed by one shared `parseCheckboxState()`.

### Layers

**Vault gateway (write enforcement):**
- Location: `src/vault-gateway.js`
- Purpose: sole write/read enforcement point for `~/Claude Cowork/`
- Depends on: `src/content-policy.js`, `src/style-policy.js`, `src/pipeline-infra.js` (config loaders)
- Used by: `today-command.js`, `promote-memories.js`, `new-command.js`, `reroute.js`, `promote-unrouted.js`, `reach-exporter.js`, `daily-stats.js` (via `vaultWriteAtomic`)

**Memory pipeline (extraction → staging → promotion):**
- Location: `src/memory-extractor.js` (transcript/vault scan → Haiku candidate extraction, chunked 100-message windows with 10-message overlap for oversized transcripts), `src/memory-proposals.js` (reader/writer for `proposals/memory-proposals.md` staging file + `proposals/memory-proposals-pending.jsonl` overflow buffer, file locking, dedup by content hash), `src/promote-memories.js` (human-reviewed candidates → `memory/memory.md`, archives originals to `archive/memory/` and `archive/proposals/`)
- Trigger: `/wrap` (Stop hook or manual), `scripts/daily-sweep.js` (nightly, mines inbox + Daily notes + transcripts), `/promote-memories` (human-in-the-loop)
- Contract: every candidate carries source attribution (`session_id`, `captured_at`, `source_file`); extraction failure never blocks `/wrap` (D-64); a failed extraction now (post PR #96) returns a distinguishable exit code from an empty one

**Retrieval (semantic + keyword):**
- Location: `src/semantic-index.js` (Voyage AI embeddings, cosine + recency-decay scoring, RRF hybrid fusion with keyword search, embed-on-promotion to `~/.cache/second-brain/embeddings.jsonl`), `src/memory-reader.js` (minisearch keyword index over `memory.md`), `src/recall-command.js` (CLI/command entry point: `--semantic`, `--hybrid`, `--category`, `--since`, `--top N`)
- Degrades gracefully: Voyage unavailable → falls back to keyword-only, gated by `utils/voyage-health.js` adaptive denial

**Reach layer (cross-surface export):**
- Location: `src/reach-exporter.js`
- Purpose: regenerates a pointer + capped-digest cache (`second-brain.md` + `MEMORY.md` index line) into every allowlisted Claude Code auto-memory directory (`config/reach-targets.json`) on every real promotion
- Boundary: reads only `memory/memory.md` (RIGHT); every digest entry re-passes the content-policy exclusion gate at egress, fail-closed (BLOCK or error → entry excluded) — required because extraction→staging bypasses the ingress gate
- See `decisions/ADR-018-cross-surface-reach.md`, `decisions/ADR-019-reach-layer-mechanism.md`

**`/today` orchestration:**
- Location: `src/today-command.js` (thin orchestrator, post-Phase-15 refactor) composing `src/today/slippage-scanner.js`, `src/today/frog-identifier.js`, `src/today/llm-augmentation.js`, `src/today/briefing-renderer.js`, `src/today/memory-health.js`, `src/today/compounding-trend.js`, `src/today/sweep-status.js`
- Flow: parallel connector fan-out (`Promise.allSettled` over `src/connectors/{calendar,gmail,github}.js`, D-01) → pipeline state fetch (proposals pending + dead letter) → slippage scan → frog identification (Haiku) → Memory Echo fetch (`src/memory-reader.js`, threshold-gated) → memory health + compounding trend (non-fatal) → synthesis (Haiku) → render → `vaultWrite()` with `attemptCount: 1` so Guard 3 quarantines rather than throws
- Quarantine-stub fallback: if the gateway quarantines the real body, `renderQuarantineStub()` writes fixed text chosen to clear both guards to the same `briefings/daily/<date>.md` path; if the stub is also quarantined (e.g. the style guide hot-reloaded a new banned word matching the stub), `runToday` returns `TODAY_FATAL` with `path: null` instead of reporting a nonexistent file
- Records `src/daily-stats.js` counters (proposals, promotions, recall hits, echo score, latencies) via `vaultWriteAtomic()`

**Classification (`/new`):**
- Location: `src/classifier.js` (two-stage LLM classifier for domain routing), `src/new-command.js`
- Flow: mixed input → classify → route to vault-gateway write or quarantine on ambiguity

**Config/infra:**
- Location: `src/pipeline-infra.js` (config loaders with local-overlay support, `createLlmClient`/`createHaikuClient`), `src/config-validator.js` (AJV schema validation), `config/schema/*.json` (one schema per config file)

### Data Flow

**Memory compounding (the core loop):**
1. Session transcript or vault file → `memory-extractor.js` → Haiku extracts candidate facts, deduped by content hash
2. Candidates written to `proposals/memory-proposals.md` (checkbox-gated) via `memory-proposals.js`, with lock-file coordination (`proposals.lock`, pid-probed reclaim)
3. Human reviews checkboxes → `/promote-memories` → `promote-memories.js` promotes accepted entries to `memory/memory.md`, archives source proposals
4. Promotion triggers non-fatal side channels: `semantic-index.js` embeds new entries, `reach-exporter.js` regenerates cross-surface pointer files, `memory-dashboard.js` rebuilds `memory/dashboard.md`, `contradiction-check.js` flags conflicts

**`/today` briefing:**
1. Config load → parallel connector fan-out (calendar/gmail/github) + pipeline state fetch
2. Slippage scan (sync, filesystem scan of `~/projects/`) → frog identification (Haiku)
3. Memory Echo retrieval (threshold 0.65 default) → memory health + compounding trend (both non-fatal, suppressed under insufficient data)
4. Synthesis (Haiku) → render → write through vault-gateway → daily-stats recorded

**State Management:** No database — the vault (`~/Claude Cowork/`) and flat config JSON files (`config/*.json`, optionally overlaid by gitignored `*.local.json`) are the only persistent state. Health trackers persist to `~/.cache/second-brain/*.json`.

### Key Abstractions

**Guard/gate pattern:** Sequential pass/block/quarantine decisions, never silent drops — every guard either passes, sanitizes (redacts a portion), or quarantines (metadata-only record). Examples: `vault-gateway.js` three guards, `content-policy.js checkContent()`.

**Never-throw result envelope:** `{success: boolean, data, error, failureMode}` shape used across connectors (`src/connectors/types.js`), LLM clients, and `runToday()`'s top-level catch (`TODAY_FATAL` envelope) — errors are data, not exceptions, at every orchestration boundary.

**Config-driven directory bootstrap:** `bootstrapVault()` derives RIGHT-side directories to create from `config.right`, never a hardcoded list.

### Entry Points

**Slash commands:** `.claude/commands/*.md` define `/today`, `/new`, `/wrap`, `/promote-memories`, `/reroute`, `/promote-unrouted`, `/recall`.

**Standalone scripts (`scripts/`):** `wrap.js`, `daily-sweep.js`, `today-scheduled.js`, `dream.js` (monthly consolidation propose/apply), `recall.js` (cross-session CLI, ADR-019), `compounding-report.js`, `verify-baseline.js`, `build-index.js`, `validate-archive.js`, `migrate-memory-wiki.js`.

**Scheduling:** macOS `launchd` — `com.secondbrain.today` (weekdays 06:45), `com.secondbrain.daily-sweep` (23:45), `com.secondbrain.dream` (1st of month 07:15); plists in `config/`.

### Error Handling

**Strategy:** fail-open for briefing rendering (briefing-is-the-product: side-channel failures never block the file write), fail-closed for vault boundary and content-policy checks (unknown path or over-threshold content → BLOCK/quarantine, never write).

**Patterns:**
- Timeout budgets propagate down and narrow, never re-inherit: a caller with a hard wall clock passes `timeoutMs`, and every layer takes `Math.min(ownTimeout, remaining)`.
- Per-file/per-candidate error isolation: `memory-extractor.js` records an `extraction-error` per file instead of aborting a whole directory sweep.

### Cross-Cutting Concerns

**Logging:** `logDecision()` in `vault-gateway.js` writes structured JSON decision logs to stderr (no `console.log` in production, ESLint-enforced); metadata only, never content payloads.

**Validation:** All config loading validates against AJV schemas (`config/schema/`) before use; `validateConfig()` in `vault-gateway.js` additionally enforces the LEFT/RIGHT intersection invariant in code.

**Authentication:** None internally — this is a local CLI/pipeline system, not a networked service. External connectors (`src/connectors/`) use OAuth scopes configured out-of-band (Gmail `gmail.compose` draft-only, Calendar read-only, GitHub issues-only).

---

## System B: Agent Canvas

### Pattern Overview

**Overall:** A single Express service (`agent-canvas/server/index.js`) serving a JSON HTTP API, a WebSocket presence/event hub, and a built Vite/React frontend from one Cloud Run container. SQLite (`node:sqlite`, WAL mode) is the only datastore, replicated to Cloud Storage via Litestream for durability across container restarts. `--max-instances 1` is required — SQLite is single-writer.

**Key characteristics:**
- **Monolithic router with modular collaborators.** `server/routes.js` (2,532 lines) is a single Express `Router` handling ~100 endpoints; it composes purpose-built modules (`memory.js`, `evidence.js`, `explain.js`, `attention.js`, `rooms.js`, `builder.js`, `standing-rules.js`, `auth.js`) rather than splitting into sub-routers.
- **Agent run loop with hard budgets.** `orchestrator/runner.js`'s `executeRun()` enforces a step budget and wall-clock timeout per run; hitting either halts and escalates rather than looping silently. The global pause (`orchestrator/control.js`) is checked before every model call.
- **Bounded-concurrency queue with stranded-run reconciliation.** `orchestrator/queue.js` runs up to `AGENT_CONCURRENCY` (default 3) runs at once; a 30s interval timer (`reconcileStrandedRuns`) detects runs stuck in `queued` for >60s and re-enqueues them (max 2 attempts) before escalating to a human — closing a silent-work-loss failure mode the team observed but could not deterministically reproduce.
- **Single write lane for HubSpot.** `server/hubspot/opsrunner.js` is the ONLY path to HubSpot mutation: it proxies to an external, IAM-gated Cloud Run service (`ctg-hs-ops-runner`, ADR-0041) via keyless Google-signed identity tokens. This file holds no HubSpot credential and mirrors the runner's deny-by-default refusal list client-side (`FORBIDDEN_PREFIXES`, `FORBIDDEN_FLAGS`) as defense-in-depth; the runner remains authoritative. Writes require two independent gates: `confirm` is never sent by default (dry-run), and `tools.js` only permits `confirm:true` from a run resumed off a human-approved escalation.
- **Read-only enrichment fan-out, explicitly uncommittable.** `server/enrichment/dispatch.js` is a thin read client of an external FastAPI service (`ctg-enrichment-dispatch`); its `/v1/commit` endpoint is deliberately unreachable from this codebase — "THERE IS NO COMMIT TOOL, and there must never be one." Per-call credits are clamped client-side (`MAX_CREDITS_CEILING = 3`) as defense-in-depth against a looping agent, on top of the service's own daily budget gate.
- **MCP connectors are read lanes by convention, not by protocol guarantee.** `server/mcp/client.js` implements a minimal Streamable-HTTP JSON-RPC MCP client with per-tool explicit enablement (owner must name each tool). A name-shaped heuristic (`isMutatingToolName()`, tokenized write/read verb sets) refuses tools that look mutating as a server-side backstop — explicitly documented as a heuristic, not a structural guarantee; the real control is the owner-authored `enabledTools` allowlist plus the fact that every actual CRM write routes through opsrunner instead.
- **Append-only shared memory with provenance.** `server/memory.js`: `memory_entries` content is immutable and rows are never DELETEd; a correction INSERTs a new row and transactionally UPDATEs exactly one field on the old row — its `superseded_by` pointer (concurrent supersession of the same entry is a surfaced conflict, never last-write-wins). Every entry carries `epistemic` state (`verified`/`inference`/`assumption`), author provenance, and optional typed fields (`kind`, `applies_to_type/id`). FTS5+bm25 retrieval when available, falling back to a scored-OR LIKE scorer (`MEMORY_FTS=0` or missing FTS5 build).
- **Standing rules reuse the run engine.** `server/standing-rules.js`: a standing rule is a stored instruction + persisted server-verifiable authorization; a rule "firing" is an ordinary ask-mode run dispatched by a tick instead of a human click — no separate execution engine, no cron parser (cadence enum + slot + occurrence-key lease instead).
- **Server clamps everything the model proposes.** Standing-rule parsing, agent authority, and budgets are all "model proposes, server validates and clamps" — `agent_id` must come from a server-supplied list, `cadence`/`output_type` from enums, budgets from clamped ranges.
- **Event bus decouples orchestrator from transport.** `server/bus.js` is a bare `EventEmitter` (`maxListeners: 50`); `ws.js` subscribes and fans events out to the right canvas's WebSocket channel by `canvasId` (`null` = broadcast to everyone).

### Layers

**HTTP/API layer:**
- Location: `server/routes.js` (single router, ~100 routes), `server/index.js` (Express app assembly, health checks, static frontend serving, boot-time seeding)
- Depends on: every other server module
- Notable: raw-body upload path (`POST /api/canvases/:id/files`) is excluded from the global JSON body parser via regex match before `express.json()` runs, so `req.body` is guaranteed a `Buffer`

**WebSocket hub:**
- Location: `server/ws.js`
- Purpose: live presence (cursors, selections) + orchestrator/domain event fan-out
- Auth: same session cookie/token as HTTP, re-verified server-side on `join` (`canAccessCanvas`)

**Orchestrator (agent run engine):**
- Location: `server/orchestrator/{runner.js, queue.js, control.js, tools.js, anthropic.js, gemini.js, pdf-extract-worker.js}`
- `runner.js`: the run loop — builds the system prompt (shared memory contract, retrieved-content-is-data warning, mode-specific rules for ask/rehearse/act), calls the model, executes tools, caps tool results re-sent into history (`TOOL_RESULT_CHAR_CAP = 40,000`, head+tail truncation)
- `queue.js`: dispatch, bounded concurrency, mode/authority/initiator inheritance for child runs (handoff/retry/resume), stranded-run reconciliation, orphan recovery on process restart
- `tools.js` (1,347 lines): tool definitions per agent role, authority intersection/allowlisting, mode-blocking (e.g. no `mcp_*` tools outside act mode), escalation creation
- `control.js`: global pause/resume, daily token budget enforcement
- `anthropic.js`/`gemini.js`: model provider adapters, tier config (fast/strong)

**Domain/data modules:**
- `server/memory.js`: shared project memory (append-only, epistemic states, FTS5 retrieval, lineage/citations)
- `server/evidence.js`: evidence-ref tagging for external tool results cited in memory writes
- `server/attention.js`, `server/rooms.js`, `server/builder.js` (agent-draft propose/rehearse/publish), `server/standing-rules.js`, `server/roster.js` (agent roster seeding/healing/reseeding), `server/explain.js` (explain-map for a run), `server/audit.js` (hash-chained audit log)

**External integration clients:**
- `server/hubspot/opsrunner.js`: sole HubSpot write lane (external ops-runner proxy)
- `server/enrichment/dispatch.js`: read-only enrichment fan-out client (external FastAPI service)
- `server/mcp/client.js` + `server/mcp/seed.js`: generic MCP connector layer, per-tool allowlisting
- `server/google/workspace.js`: Gmail/Drive/Sheets/Calendar via the grantor's own OAuth connection
- `server/gcp-identity.js`: keyless Google-signed identity tokens for service-to-service calls (shared by opsrunner and enrichment dispatch)

**Persistence:**
- Location: `server/db.js`
- SQLite via `node:sqlite` (`DatabaseSync`), WAL mode, `busy_timeout=5000`, foreign keys on
- Tables: `users`, `allowlist`, `canvases`, `canvas_members`, `agents`, `notes`, `files`, `tasks`, `memory_entries` (+ more not shown in the first 120 lines: `runs`, `run_events`, `standing_rules`, `mcp_servers`, etc., referenced throughout `routes.js`)
- `DATA_DIR`/`DB_PATH` env-overridable; default `agent-canvas/data/agent-canvas.db`

**Frontend:**
- Location: `agent-canvas/frontend/src/` — flat React/Vite app, 22 top-level `.jsx`/`.js` files, no nested component directories (see STRUCTURE.md)

### Data Flow

**Agent run dispatch:**
1. `POST /api/canvases/:id/agents/:agentId/dispatch` (router mounted at `/api` in `server/index.js`) → `queue.js dispatchRun()` validates agent lifecycle (draft agents may only `rehearse`), inherits mode/authority/initiator from a parent run if this is a handoff/retry/resume, inserts a `runs` row (`status: queued`), emits a `run_status` bus event, pushes onto the in-memory queue
2. `pump()` (bounded by `AGENT_CONCURRENCY`) shifts the queue and calls `runner.js executeRun()`
3. `executeRun()` builds the system prompt (agent role + pinned canvas notes + mode block + shared-memory contract + prompt-injection warning), loops model calls up to `step_budget`/`wall_ms_budget`, executing tools via `orchestrator/tools.js`
4. Tool calls that read external content are wrapped in `<external_content>` tags in the prompt — explicitly marked as data, never instructions, defending against prompt injection from email/CRM/web content
5. Every tool result is recorded (truncated) in `run_events`; the model-facing copy is separately capped at 40k chars
6. `complete` tool call ends the run; a stranded/orphaned run (server restart, dispatch failure before `executeRun` takes over) is caught and turned into a `failed` run + escalation rather than sitting in `queued` forever

**HubSpot write:**
1. Agent calls an `hs_*` tool → `tools.js` checks mode (never in ask/rehearse except `hs_preview_change`) and authority
2. `opsrunner.js runArgv()` client-side-refuses forbidden argv prefixes/flags, fetches a GCP identity token, POSTs to the external ops-runner with `confirm` omitted (preview) or `true` (apply, only reachable from an approved-escalation resume path)
3. Ops-runner is the actual policy/credential authority; this codebase never holds a HubSpot token

**Standing rule tick:**
1. Cloud Scheduler (or `POST /api/standing-rules/tick`) fires hourly
2. `standing-rules.js` computes due occurrences per active rule, takes a conditional-claim lease on the occurrence row (`LEASE_FLOOR_MS = 10min`, `LEASE_SLACK_MS = 5min` to outlive the run it guards)
3. Dispatches an ask-mode run via `queue.js dispatchRun()` with the rule's sources/budget; on completion the rule's alert/brief is delivered

**State Management:** SQLite is the single source of truth; no in-memory session store beyond the run queue and WebSocket channel maps. `server/bus.js` is the only cross-module in-process signaling mechanism.

### Key Abstractions

**Run modes (`act`/`ask`/`rehearse`):** Every run carries a mode that gates which tools are available server-side (never trusted to the model or system prompt alone) — `ask` blocks all world-mutating tools, `rehearse` blocks mutations and shared-memory writes (findings go in the summary instead), `act` is unrestricted by mode (still gated by role/authority).

**Authority intersection:** `parseAuthority`/`intersectAuthority`/`allowedByAuthority`/`effectiveAuthority` (`tools.js`) compute the tool surface as an intersection of role-menu, mode-block, and any inherited/snapshotted authority grant — `NULL` authority is the identity element (unrestricted), so every child-run path (retry/handoff/escalation-answer/resume) must explicitly inherit it or a restricted run's child is silently born unrestricted.

**Epistemic memory states:** `verified`/`inference`/`assumption` on every memory entry, enforced server-side — an agent can never self-upgrade its own inference/assumption to verified; only independent verification (another agent, a deterministic check, a human decision) can.

**Provenance/lineage:** citations (`cites`) plus `run_reads` answer "which inputs produced this output" for any memory entry or run.

### Entry Points

**HTTP server boot:** `server/index.js` — seeds the DB if empty, retires legacy artifacts, seeds/heals/reseeds the agent roster, seeds MCP servers, reloads the MCP client, recovers orphaned runs, then starts listening.

**Health checks:** `GET /healthz` and `GET /api/healthz` (registered before the `/api` router so they stay unauthenticated) — `/healthz` alone never reaches the container in production because Cloud Run's Google Frontend reserves that path.

**Scheduled tick:** `POST /api/standing-rules/tick`, called by an external Cloud Scheduler job.

**Sibling MCP bridge services (separate deployables, same repo):** `agent-canvas/hubspot-mcp-bridge/server.js`, `agent-canvas/gtm-mcp-bridge/server.js` — each has its own `Dockerfile`/`deploy.sh`, not part of the main Cloud Run service.

### Error Handling

**Strategy:** fail-closed for authority/mode checks and HubSpot writes (deny by default, explicit allowlist to permit); fail-open/escalate for orchestration failures (a stranded or dispatch-failed run becomes a `failed` row + human escalation, never a silent drop).

**Patterns:**
- `asyncRoute()` wrapper in `routes.js` for async handlers so a thrown/rejected promise reaches Express error handling instead of hanging the request.
- Every external client (`opsrunner.js`, `enrichment/dispatch.js`, `mcp/client.js`) throws a caught, message-capped `Error` on non-2xx rather than letting `fetch` errors propagate raw; every call is audited (`audit()`) with status/timing regardless of outcome.

### Cross-Cutting Concerns

**Logging/audit:** `server/audit.js` — hash-chained audit log (`verifyChain`/`verifyChainTail`), every privileged action (`run.dispatch`, `hubspot.run`, `enrichment.call`, etc.) recorded.

**Validation:** Route-level input validation is inline per-handler in `routes.js`; external-client modules validate their own narrow input shapes (`assertDomain`, `assertKey`, `assertType` in `enrichment/dispatch.js`; `assertSafeArgv` in `opsrunner.js`).

**Authentication:** `server/auth.js` — session-token based (`requireAuth`, `requireOwner`, `requireCanvas`), Google OAuth login plus a `DEV_AUTH=1` dev bypass; role model is `owner`/`member` at both the workspace (`allowlist` table) and per-canvas (`canvas_members.access`: `edit`/`view`) level.

**Rate limiting:** `server/ratelimit.js`, applied per-route-category (`auth`, `model`, `probe`, `static`) via `express-rate-limit`.

---

## How the Two Systems Cohabit

- **One git repository, two independent Node projects.** Root `package.json` governs the second-brain pipeline (Jest, ESLint flat config, root `src/`/`test/`/`scripts/`). `agent-canvas/package.json` is a separate Node project with its own dependencies (`express`, `ws`, `@anthropic-ai/sdk`, `@google/genai`, `pdfjs-dist`), its own `node --test` runner, its own `npm run verify` gate (backend tests + frontend vitest + frontend build + deploy script self-test), and its own `agent-canvas/CLAUDE.md` project instructions layered on top of the root one.
- **No shared runtime code.** Neither system `require()`s the other. The coupling is purely organizational: same git history, same top-level GSD planning conventions (`.planning/`), same operator.
- **Separate deployment targets.** The second-brain pipeline has no deployment — it runs locally via `launchd` and Claude Code hooks against the local Obsidian vault. Agent-canvas deploys to Cloud Run (`agent-canvas-ctg-0811` project, `deploy/deploy.sh`) as a standalone containerized service with its own SQLite+Litestream durability story.
- **Separate CI gates.** Root CI runs the second-brain Jest suite, ESLint, CodeQL, coverage thresholds. Agent-canvas's `npm run verify` is invoked independently and is not part of the root `npm test`.
- **Documentation is scoped per-system.** `.planning/codebase/*.md` (this file included) documents the root pipeline plus, as of this analysis, agent-canvas at the same level. `agent-canvas/docs/` (`HANDOFF.md`, `ROADMAP.md`, `DEPLOY.md`, `DEVOPS-HANDOFF.md`) is agent-canvas's own separately-maintained doc set and is the authoritative source for its current state — this file summarizes structure, not day-to-day status.
- **Practical implication for future work:** a phase touching `agent-canvas/` should load agent-canvas's own `CLAUDE.md` and `docs/HANDOFF.md`, not assume root `src/` conventions apply (different test runner, different lint config location, different deployment model). A phase touching root `src/` should never assume `agent-canvas/` dependencies or patterns are relevant.

---

*Architecture analysis: 2026-08-19*
