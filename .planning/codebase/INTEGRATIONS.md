# External Integrations

**Analysis Date:** 2026-08-18

Two integration surfaces: the **second-brain pipeline** (local-only, vault +
LLM providers) and **agent-canvas** (a deployed Cloud Run service with a much
larger external footprint: GCP infra, Google Workspace OAuth, HubSpot, GTM
BigQuery data, and MCP connectors).

---

## Part 1 — second-brain pipeline

### AI Model Providers

**Anthropic (primary):**
- SDK: `@anthropic-ai/sdk` ^0.112.5.
- Used for: two-stage LLM classification (`src/classifier.js`), memory extraction, content-policy Stage-2 Haiku classification (`src/content-policy.js`), wikilink relevance.
- Model tiers: Haiku default, escalates to Sonnet on low confidence (`sonnetEscalationThreshold: 0.8` in `config/pipeline.json`).
- Auth: `ANTHROPIC_API_KEY` env var (not committed; loaded via `dotenv`).

**LM Studio (local fallback):**
- Config: `config/pipeline.local.json` (gitignored overlay) sets `classifier.llm.provider: "local"`, `localModel: "qwen/qwen3.6-27b"`, `localTimeoutMs: 900000`.
- Endpoint: `config/pipeline.json` `classifier.llm.localEndpoint: "http://localhost:1234"` — OpenAI-compatible `/v1/chat/completions` (`src/pipeline-infra.js` line ~203).
- Health-gated: `src/utils/classifier-health.js` tracks local-provider failures (http/parse/timeout) and gates a capped Haiku fallback rather than silently downgrading (per code comment: "must fail loudly").
- Model loaded at 65,536-token context on the local machine (per project CLAUDE.md), flash attention + q8_0 K/V cache.

**Voyage AI (semantic embeddings):**
- SDK: `voyageai` 0.2.1.
- Used for: `/recall --semantic` and `--hybrid` (`src/semantic-index.js`), embed-on-promotion.
- Auth: `VOYAGE_API_KEY` env var. Missing/invalid key logs a warning and falls back to keyword search (`src/semantic-index.js` line ~101) rather than failing.
- Similarity threshold 0.55 + recency decay; RRF fusion for hybrid mode.

### Vault Substrate

**Obsidian (Local REST API plugin):**
- Vault at `~/Claude Cowork/`, coupled via the **Docker MCP Gateway** (`mcp__MCP_DOCKER__*` tools) + Obsidian's Local REST API plugin, port 27123 (per `README.md`, `agent-canvas` sibling repo's `docs/DEVOPS-HANDOFF.md` documents the same port convention for its own MCP work — root project's own docs confirm the 27123 default).
- Not a direct HTTP client in `src/` — the coupling happens through the MCP gateway tool surface available to Claude Code sessions, not through a committed REST client module.
- Write boundary enforced in-process by `src/vault-gateway.js` (LEFT read-only / RIGHT agent-writable split), independent of the MCP transport.

### Scheduling

**macOS launchd (primary):**
- `com.secondbrain.today` — weekdays 06:45 local, runs `/today` in scheduled mode.
- `com.secondbrain.daily-sweep` — 23:45, mines inbox + daily notes + transcripts.
- `com.secondbrain.dream` — monthly, 1st at 07:15, runs `npm run dream:propose` only (`dream:apply` is human-invoked, never scheduled).
- Plist sources committed at `config/com.secondbrain.*.plist`; installed manually into `~/Library/LaunchAgents/`.

**RemoteTrigger (disabled by design):**
- `config/scheduling.json` defines a cloud-based `RemoteTrigger` (`second-brain-daily-briefing`, cron `45 11 * * 1-5` UTC) with a Google-Calendar MCP connection, but `enabled: false` — the cloud environment cannot reach the local vault, so its `/today` writes "go into the void."
- Documented fallback chain: launchd (primary) → CronCreate (`.claude/scheduled_tasks.json`, 7-day auto-expiry) → RemoteTrigger (disabled).

### CI/CD
- No cloud CI/CD for the pipeline itself beyond GitHub Actions gates referenced in project docs (ESLint, CodeQL SAST, license-checker, Node 22 matrix, coverage thresholds, GitGuardian secrets scan) — enforced via repo-managed git hooks (`hooks/pre-commit`, `hooks/pre-push`) plus GitHub-side CI.

### Environment Configuration
- `.env` (gitignored) loaded via `dotenv` — holds `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`.
- `config/*.local.json` overlays (gitignored) hold machine-specific overrides (e.g., local LLM provider).
- Secrets never appear in `config/*.json` (committed) — only in gitignored `.env`/`.local.json`.

---

## Part 2 — agent-canvas (Cloud Run deployment)

### Google Cloud Platform (project `agent-canvas-ctg-0811`, region `us-central1`)

**Cloud Run:**
- Main service `agent-canvas` — `--allow-unauthenticated` at the transport layer; app enforces Google sign-in + domain allowlist itself (`server/auth.js`). `--max-instances 1` (SQLite single-writer), `--memory 1Gi --cpu 1`.
- Sidecar services `hubspot-mcp-bridge` and `gtm-mcp-bridge` — both `--no-allow-unauthenticated` (IAM-gated), with the canvas's own runtime SA (`agent-canvas-run@...`) granted `roles/run.invoker` on each.

**Cloud Build:**
- `cloudbuild.yaml` — one Docker build step with `DOCKER_BUILDKIT=1`. Builds run under a dedicated `agent-canvas-build` service account (`roles/cloudbuild.builds.builder`) rather than a project default, because newer GCP projects often lack a usable default Cloud Build SA.

**Secret Manager:**
- `jwt-secret` — session-signing secret, auto-generated on first deploy if absent.
- `anthropic-api-key` — only created/bound when `MODEL_PROVIDER=anthropic`.
- `google-oauth-secret` — Workspace OAuth client secret (optional; app runs canvas-only without it).
- `rapidapi-key` — optional, for LinkedIn MCP connectors.
- `hubspot-mcp-token` — read-only HubSpot private-app token (`pat-*` shaped, paste-guarded) for `hubspot-mcp-bridge`.
- Deploy script includes explicit **paste guards**: `ANTHROPIC_API_KEY` must start with `sk-ant-`, `GOOGLE_CLIENT_SECRET` must start with `GOCSPX-` — refuses to store a mangled/placeholder paste as a real secret version.

**Cloud Scheduler:**
- API enabled by `deploy.sh` (`cloudscheduler.googleapis.com`); referenced by the `TICK_AUDIENCE`/`TICK_INVOKER_SA` env vars that gate the "P5 standing-rule scheduler tick" OIDC lane (`server/standing-rules.js` family) — both vars must be set or the tick lane 503s (visually: "STANDING RULES · TICK" lamp dark).

**GCS / Litestream:**
- Bucket `gs://agent-canvas-ctg-0811-db`, `roles/storage.objectAdmin` granted to the runtime SA.
- `LITESTREAM_REPLICA_URL=gcs://agent-canvas-ctg-0811-db/agent-canvas` — continuous SQLite replication; a cold Cloud Run start restores the DB from this bucket via Litestream, keyless (Cloud Run SA's ADC).

**IAM / keyless identity:**
- Runtime SA `agent-canvas-run@agent-canvas-ctg-0811.iam.gserviceaccount.com` — least privilege: bucket objects + specific secrets, plus `roles/aiplatform.user` when `MODEL_PROVIDER != anthropic` (Vertex mode).
- `server/gcp-identity.js` — single shared helper (`identityToken(audience, {escapeHatchEnv})`) for every Google-signed identity token this service mints, via the Cloud Run metadata server (`http://metadata.google.internal/...identity?audience=...`). No service-account key is ever minted or stored. Cached per-audience (tokens live ~1h, cached 45min).
- Used by: `server/hubspot/opsrunner.js` (HS_OPS_RUNNER_URL), `server/enrichment/dispatch.js` (ED_DISPATCH_URL), the two MCP bridge calls (`${GCP_IDTOKEN}` header pattern).

### Vertex AI / Model Providers
- **Vertex (default, `MODEL_PROVIDER=vertex`)** — Claude served via `@anthropic-ai/vertex-sdk`, keyless (runtime SA ADC), billed on the Google invoice. Requires the operator to manually enable `claude-sonnet-5`, `claude-haiku-4-5`, `claude-opus-4-8` in Vertex Model Garden (a one-time console step `deploy.sh` prints as STEP 1).
- **Anthropic (`MODEL_PROVIDER=anthropic`)** — first-party API, `ANTHROPIC_API_KEY` (x-api-key) or OAuth bearer token.
- **Gemini (`MODEL_PROVIDER=gemini`)** — `@google/genai`, Gemini models on Vertex.
- `deploy.sh` treats a provider change as a deliberate, gated act: an *inherited* provider requires no shell credential at all; an *explicit* provider switch away from the live one requires `DEPLOY_PROVIDER_CHANGE=1`.

### Google Workspace OAuth (`server/google/workspace.js`, `server/auth.js`)
- **Sign-in:** Google OAuth restricted to `ALLOWED_DOMAIN` (default `cloudtechgurus.com`) plus a server-side allowlist re-checked on *every request* (not just at token issuance) — removing a user locks them out immediately.
- **DEV_AUTH=1** dev-only bypass path — structurally disabled in production because it additionally requires `NODE_ENV !== 'production'`, and the Dockerfile sets `NODE_ENV=production`.
- **Workspace data scopes**, gated by `GOOGLE_WORKSPACE_SCOPES=full|standard` (default `full`):
  - Standard (always requested): `drive.file`, `spreadsheets`, `calendar.events`.
  - Restricted (full mode only, Google-verification-gated): `drive.readonly`, `gmail.readonly`, `gmail.compose` (drafts only — **no send scope requested**).
- Gmail is entirely disabled in `standard` scope mode (throws explicitly if called).
- Sessions: JWT (`jsonwebtoken`), cookie `ac_session`, 7-day TTL, secret from `JWT_SECRET` env (prod) or a DB-persisted generated secret (dev).

### HubSpot (two separate, non-overlapping lanes)

**Write lane — `server/hubspot/opsrunner.js` → `ctg-hs-ops-runner` (external service, different GCP project `ctg-hs-exec-tool`):**
- The **sole execution authority** for any HubSpot write (ADR-0041 Rev A). This file holds **no HubSpot credential** — authenticates service-to-service via keyless Google-signed identity token (`server/gcp-identity.js`), calling `HS_OPS_RUNNER_URL` (optional; unset ⇒ `configured()` is false and the client refuses cleanly).
- Deny-by-default 73-command policy engine lives in the *runner*, not here; this file mirrors a forbidden-prefix/forbidden-flag list client-side as defense in depth (e.g., `objects delete`, `objects merge`, `--token`, `--config`).
- Two independent write gates: `preview` never sends `confirm`, so the runner dry-runs by default; `apply` (confirm:true) is only reachable from a run resumed after a human-approved escalation (enforced in `server/orchestrator/tools.js`, not this file).
- Named operations only: `types`, `list`, `get`, `search`, `pipelines`, `pipeline_stages`, `owners`, `properties`, `associations`, `change` (create/update/upsert) — no raw-argv passthrough exposed to agents.
- Requires a separate one-time grant: the canvas's runtime SA must be given `roles/run.invoker` on `ctg-hs-ops-runner` in the `ctg-hs-exec-tool` project (documented as a manual step in `deploy.sh`'s printed checklist, since that project is owned separately).

**Read lane — `agent-canvas/hubspot-mcp-bridge/` (own Cloud Run service):**
- Spawns `@hubspot/mcp-server@0.4.0` as a child process, credentialed with a **read-only** private-app token (`HUBSPOT_MCP_TOKEN` from Secret Manager `hubspot-mcp-token`, `pat-*` shaped).
- Bridges Streamable-HTTP (`POST /crm`) to the child's stdio JSON-RPC. Verified before building (2026-08-13) that `mcp.hubspot.com`'s own remote endpoint is OAuth-only (401 + resource_metadata, no PAT support), so this bridge is not optional.
- IAM-gated (`--no-allow-unauthenticated`); only the canvas SA is granted `roles/run.invoker`. Runs as the default compute SA (flagged in code comments as open finding F-03 — no dedicated runtime SA, unlike gtm-mcp-bridge).

### GTM Marts (BigQuery, `agent-canvas/gtm-mcp-bridge/`)
- Own Cloud Run service, own dedicated runtime SA `gtm-bridge-run@agent-canvas-ctg-0811...` (explicit, unlike hubspot-mcp-bridge).
- Runs 4 fixed, named BigQuery SQL queries (`gtm_account_lookup`, `gtm_tier_list`, `gtm_enrichment_spend`, `gtm_dq_snapshot`) against **physical tables only** in `ctg-hs-exec-tool:ctg_gtm_marts` — deliberately never `ctg_gtm_raw`, which holds 44k people's PII.
- Auth: BigQuery REST `jobs.query` via metadata-server access token (keyless); query jobs run in and bill to `agent-canvas-ctg-0811` (`roles/bigquery.jobUser`), reading cross-project from `ctg-hs-exec-tool` (dataset-scoped `READER`, granted manually by a data owner — not by this script).
- IAM-gated (`--no-allow-unauthenticated`), canvas SA sole invoker.

### Enrichment Dispatch (`server/enrichment/dispatch.js`)
- Thin read client of `ctg-enrichment-dispatch` (separate FastAPI service, Pete's estate, own repo) — same keyless-identity-token pattern as the ops-runner.
- No credential of its own; disabled entirely when `ED_DISPATCH_URL` is unset (tools.js does not even offer the tool to models in that case).
- Hard constraint enforced client-side: no commit tool exists here — any CRM write must go back through the ops-runner preview/apply lane; enrichment results return to the agent as data only.
- Per-call spend capped client-side (`MAX_CREDITS_CEILING = 3`), on top of the service's own unset-daily-budget fail-closed guarantee.

### MCP Connectors (`server/mcp/client.js`, `server/mcp/seed.js`)
- Generic MCP client: raw JSON-RPC over Streamable-HTTP, connector rows stored in SQLite (`mcp_servers` table), each with `headers_json` supporting `${ENV:VAR}` and `${GCP_IDTOKEN}` placeholder resolution per-request (never stored resolved).
- Seeded connectors (idempotent, versioned seed key `seed_mcp_v3`):
  - `linkedin-fresh`, `linkedin-blitz` — RapidAPI LinkedIn data APIs (`${ENV:RAPIDAPI_KEY}`).
  - `sr-icp-leadfinder` — external `sr-icp-connector.fly.dev` service (Streamable-HTTP+SSE, no auth header).
  - `gtm-marts` — this repo's own `gtm-mcp-bridge`, authenticated via `${GCP_IDTOKEN}`.
- All connectors start with `enabled_tools_json: '[]'` — inert until an owner explicitly probes and ticks individual tools in Admin → Connectors (per-tool consent model).

### Document Parsing (not external services, but external-format ingestion)
- `exceljs` — `.xlsx` read/write.
- `mammoth` — `.docx` → text/HTML.
- `pdfjs-dist` — PDF text extraction (`server/orchestrator/pdf-extract-worker.js`).

### Environment Configuration Summary (agent-canvas)
- Required for first deploy: none strictly — `deploy.sh` bootstraps project/billing/APIs itself; `MODEL_PROVIDER` defaults to `vertex`.
- Notable optional env vars: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (Workspace OAuth), `HS_OPS_RUNNER_URL` (HubSpot writes), `ED_DISPATCH_URL` (enrichment), `TICK_AUDIENCE`/`TICK_INVOKER_SA` (standing-rules scheduler), `RAPIDAPI_KEY` (LinkedIn connectors), `GOOGLE_WORKSPACE_SCOPES` (full|standard).
- **Deploy is additive by design**: `--update-env-vars`/`--update-secrets` never drop a live variable as a side effect; removal requires an explicit `gcloud run services update --remove-env-vars`.

---

*Integration audit: 2026-08-18*
