# External Integrations

**Analysis Date:** 2026-07-21

## AI / LLM Providers

**Anthropic (primary):**
- SDK: `@anthropic-ai/sdk` `0.91.1`, instantiated in `src/pipeline-infra.js:170` (`new Anthropic()`)
- Models: Haiku (default classify/extract) escalating to Sonnet per `config/pipeline.json` thresholds (`stage2ConfidenceThreshold`, `sonnetEscalationThreshold: 0.8`, `sonnetAcceptThreshold: 0.7`)
- Auth: `ANTHROPIC_API_KEY` env var (required) — missing/invalid key makes `pipeline-infra.js` return a stub `classify()` that always degrades gracefully rather than throwing
- Consumers: `src/classifier.js` (`/new` routing), memory extraction, `src/today/llm-augmentation.js` (`/today` briefing), `src/dream.js` / `scripts/dream.js` (dream consolidation)

**LM Studio (local fallback):**
- OpenAI-compatible HTTP endpoint. Config: `config/pipeline.json` → `classifier.llm.localEndpoint: "http://localhost:1234"`, `localModel: "qwen/qwen3.6-27b"`
- Implementation: `classifyLocal()` in `src/pipeline-infra.js:186-280` — POSTs to `${localEndpoint}/v1/chat/completions`; 10s default timeout via `AbortController` (`llmConfig.localTimeoutMs`); optional `Authorization: Bearer` header from `LM_API_TOKEN` env var (documented in `.env.template:4-6` as required "when Require Authentication is enabled" in LM Studio's server settings)
- Model quirks handled in code: `response_format: {type:'text'}` (LM Studio dropped `json_object`), `reasoning_effort: 'none'` + `chat_template_kwargs.enable_thinking: false` to suppress the model's hidden `<think>` phase (verified against qwen3.6-27b — `enable_thinking` alone left `content` empty)
- Selection logic: active only when `config/pipeline.json` `classifier.llm.provider === 'local'` **and** `process.env.LLM_PROVIDER !== 'anthropic'` (`src/pipeline-infra.js:162-163`) — unattended/scheduled runs (the dream-propose launchd job) force `LLM_PROVIDER=anthropic` to bypass local entirely
- Failure handling: network/timeout errors (`ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`, abort, `fetch failed`) fall back to Anthropic Haiku, capped nightly at 50 calls (`config/pipeline.json` `haikuNightlyCap`, tracked in `src/utils/classifier-health.js`); JSON parse errors return immediately with **no** fallback
- Health tracking: `src/utils/classifier-health.js` — cross-invocation failure counts, degraded windows, and a per-night Haiku-fallback counter that resets when the stored date differs from today

**Voyage AI (semantic embeddings):**
- SDK: `voyageai` `0.2.1` (exact pin — see STACK.md)
- Model: `voyage-4-lite` (`config/pipeline.json` `memory.semantic.model`), `embeddingDim: 1024`
- Auth: `VOYAGE_API_KEY` env var, **optional** — its absence degrades `/recall --semantic` and `--hybrid` to keyword-only search with a warning banner (`docs/DEVOPS-HANDOFF.md:39`)
- Implementation: `src/semantic-index.js` — embed-on-promotion writes to `~/.cache/second-brain/embeddings.jsonl`; query-time scoring is cosine similarity + recency decay (`recencyDecay: 0.2`) gated by an excluded-terms scan applied **before** any Voyage call; hybrid mode does RRF fusion with keyword results (`rrfK: 60`)
- Timeout: `3000ms` (`memory.semantic.timeoutMs`); batch size up to 128 entries per embed call (`embedBatchSize`)
- Health/degradation: `src/utils/voyage-health.js` implements Pattern 7 (Adaptive Denial Tracking), persisting to `~/.cache/second-brain/voyage-health.json`. Three consecutive failures of any class (`401`, `429`, `5xx`, `timeout`, `network` — classified by `classifyVoyageError()` in `src/semantic-index.js:63-72`) trip a 15-minute degraded window (`degradedModeMinutes`); one successful call resets `consecutive_failures` to 0

## Vault Substrate (Obsidian)

- Version: Obsidian 1.7+ with the Local REST API plugin running, port `27123` default (`docs/DEVOPS-HANDOFF.md:11`)
- Vault root: `~/Claude Cowork`, overridable via `VAULT_ROOT` env var (`src/vault-gateway.js:45`, defaults to `path.join(process.env.HOME, 'Claude Cowork')`)
- **Two distinct access paths, not one:**
  1. `src/vault-gateway.js` reads/writes vault markdown **directly via Node `fs`**, not through the REST API — it is the single write-enforcement point (LEFT/RIGHT path allowlist, then content-policy + style-policy gates), and watches `config/` for hot-reload via `chokidar`
  2. The **Obsidian Local REST API plugin + Docker MCP Gateway** is the transport Claude Code itself uses to browse/edit the vault interactively from inside a session (`README.md:14`: "They couple via MCP (Docker MCP Gateway + Obsidian Local REST API plugin)") — this path is not called from anything in `src/`

## MCP Connectors (`src/connectors/`)

**GitHub** (`src/connectors/github.js`):
- Docker MCP Gateway tools: `list_commits`, `list_issues`, `list_pull_requests`
- Scoped to `config/connectors.json` → `github.owner: "UsernameTron"`, `github.repos: ["second-brain"]`
- `list_pull_requests` has no `since` param, so PRs are filtered client-side by `updated_at` (`_fetchRepo`, line 63)
- Partial-failure tolerant: `Promise.allSettled` per tool per repo; returns a `warnings` array unless every call fails, in which case `makeError` is returned

**Gmail** (`src/connectors/gmail.js`):
- MCP server: `gmail-mcp-pete` (a claude.ai connector, not Docker MCP), exposing `list_recent_messages`, `get_message_body`, `create_draft`
- Draft-only by design: no send tool is called and no send-verb function is exported (OAuth scope `gmail.compose`, excludes `gmail.send`)
- Two-layer VIP filtering: server-side `allowedSenders` param from `config/connectors.json` → `gmail.vipSenders` (trust-boundary enforcement) plus a connector-side case-insensitive re-filter as defense-in-depth

**Google Calendar** (`src/connectors/calendar.js`):
- Transport: Cowork-native MCP tools (`mcp__claude_ai_Google_Calendar__*`), a claude.ai connector, via dependency-injected `mcpClient`
- Read-only by API omission: only `getCalendarEvents` / `getEvent` are exported, no create/update/delete
- In-connector filters: declined-event filter (attendee `responseStatus`) and a timezone-aware working-hours filter (`config/connectors.json` → `calendar.workingHours: {start:8, end:18}`, via `Intl.DateTimeFormat`)
- Supports a `remote` mode (injected `_remoteCallTool`) for the RemoteTrigger cloud path — currently disabled (see Scheduling below)

Note: `.mcp.json` at the repo root registers only `context7` (Upstash docs MCP for development). Gmail/Calendar/GitHub/Obsidian MCP connections are configured at the Claude Desktop / claude.ai account level, not in repo config.

## Scheduling & Automation (macOS launchd)

- **`com.secondbrain.today`** — **not committed to the repo** (plist exists only at `~/Library/LaunchAgents/com.secondbrain.today.plist`; documented in `config/scheduling.json` `notes.local_scheduler`). Runs weekdays 06:45 America/Chicago local (per-weekday `StartCalendarInterval` array), executing `node -e "require('./src/today-command').runToday({mode:'scheduled'})..."` with `WorkingDirectory=/Users/cpconnor/projects/second-brain` and `VAULT_ROOT` set. This is the only scheduled path that reaches the local vault.
- **`com.secondbrain.daily-sweep`** — committed at `config/com.secondbrain.daily-sweep.plist`; daily 23:45 local, runs `scripts/daily-sweep.js` (mines inbox + Daily notes + transcripts into memory proposals — not inbox-only)
- **`com.secondbrain.dream`** — committed at `config/com.secondbrain.dream.plist`; monthly (Day 1, 07:15 America/Chicago), runs `node scripts/dream.js --propose` only (`--apply` is human-invoked and never scheduled); sets `LLM_PROVIDER=anthropic` in its environment to bypass the LM Studio overlay for unattended runs; `RunAtLoad: false`

**Fallback chain** (`config/scheduling.json` `fallback_chain`): macOS launchd (primary) → Claude Desktop `CronCreate` (`.claude/scheduled_tasks.json`, 7-day auto-expiry) → RemoteTrigger (disabled)

**RemoteTrigger** (disabled by design): `trig_01KvxeDfYDAEwAzw9zw9DKKB`, cron `45 11 * * 1-5` UTC, model `claude-sonnet-4-6`, one MCP connection (Google Calendar). `enabled: false` since v1.7 Phase 29 (STATS-PIPE-03) — its cloud environment (`env_01TjBJLSRwHfpUPcNVUK99Kb`) cannot reach the local `VAULT_ROOT`, so its `/today` writes would go nowhere reachable.

## Environment Configuration

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic classification/briefing (`docs/DEVOPS-HANDOFF.md:38`) |
| `VOYAGE_API_KEY` | Optional | Semantic embeddings; absent → keyword-only fallback |
| `LM_API_TOKEN` | Optional | Bearer auth to LM Studio when its server requires authentication (`.env.template:4-6`) |
| `VAULT_ROOT` | Optional | Overrides vault path, default `~/Claude Cowork` |
| `PROJECTS_DIR` | Optional | Cross-project GSD state root, default `/Users/cpconnor/projects` (`.env.template:2`) |
| `LLM_PROVIDER` | Optional | `=anthropic` forces Anthropic even when config says `provider: local`; used by scheduled jobs |
| `CONFIG_DIR_OVERRIDE` / `CACHE_DIR_OVERRIDE` | Test-only | Isolation for config/cache paths in tests |

Secrets live in `.env` (gitignored); shape documented in `.env.template`.

## Cross-Surface Reach (memory export)

- `config/reach-targets.json` lists 15 target directories — other Claude Code projects' `memory/` folders on this machine — that `src/reach-exporter.js` writes a pointer + digest cache to on every real memory promotion (ADR-019, `decisions/ADR-019-reach-layer-mechanism.md`). Digest entries re-pass the content-policy exclusion gate at egress, fail-closed.

## Webhooks & Callbacks

**Incoming:** None — all external data (Gmail, Calendar, GitHub) is pulled on-demand or on a schedule, not pushed via webhook.
**Outgoing:** None.

---

*Integration audit: 2026-07-21*
