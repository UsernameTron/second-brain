# External Integrations

**Analysis Date:** 2026-07-26

## AI / LLM Providers

**Anthropic (primary):**
- SDK: `@anthropic-ai/sdk` `^0.112.5`, instantiated in `src/pipeline-infra.js` (`new Anthropic()`)
- Models: Haiku (default classify/extract) escalating to Sonnet per `config/pipeline.json` thresholds (`stage2ConfidenceThreshold`, `sonnetEscalationThreshold: 0.8`, `sonnetAcceptThreshold: 0.7`)
- Auth: `ANTHROPIC_API_KEY` env var (required) — missing/invalid key makes `pipeline-infra.js` return a stub `classify()` that always degrades gracefully rather than throwing
- Consumers: `src/classifier.js` (`/new` routing), memory extraction, `src/today/llm-augmentation.js` (`/today` briefing), `src/dream.js` / `scripts/dream.js` (dream consolidation)

**LM Studio (local fallback):**
- OpenAI-compatible HTTP endpoint. Config: `config/pipeline.json` → `classifier.llm.localEndpoint: "http://localhost:1234"`, `localModel: "qwen/qwen3.6-27b"`
- Implementation: `classifyLocal()` in `src/pipeline-infra.js` — POSTs to `${localEndpoint}/v1/chat/completions`; 10s default timeout via `AbortController`; optional `Authorization: Bearer` header from `LM_API_TOKEN` env var
- Selection logic: active only when `config/pipeline.json` `classifier.llm.provider === 'local'` **and** `process.env.LLM_PROVIDER !== 'anthropic'` — unattended/scheduled runs (dream-propose launchd job) force `LLM_PROVIDER=anthropic` to bypass local entirely
- Failure handling: network/timeout errors fall back to Anthropic Haiku, capped nightly at 50 calls (`config/pipeline.json` `haikuNightlyCap`, tracked in `src/utils/classifier-health.js`); JSON parse errors return immediately with **no** fallback

**Voyage AI (semantic embeddings):**
- SDK: `voyageai` `0.2.1` (exact pin — see STACK.md)
- Model: `voyage-4-lite` (`config/pipeline.json` `memory.semantic.model`), `embeddingDim: 1024`
- Auth: `VOYAGE_API_KEY` env var, **optional** — its absence degrades `/recall --semantic` and `--hybrid` to keyword-only search with a warning banner
- Implementation: `src/semantic-index.js` — embed-on-promotion writes to `~/.cache/second-brain/embeddings.jsonl`; query-time scoring is cosine similarity + recency decay, gated by an excluded-terms scan applied **before** any Voyage call; hybrid mode does RRF fusion with keyword results (`rrfK: 60`)
- Health/degradation: `src/utils/voyage-health.js` implements Pattern 7 (Adaptive Denial Tracking), persisting to `~/.cache/second-brain/voyage-health.json`

## Vault Substrate (Obsidian)

- Version: Obsidian 1.7+ with the Local REST API plugin running, port `27123` default
- Vault root: `~/Claude Cowork`, overridable via `VAULT_ROOT` env var (`src/vault-gateway.js`, defaults to `path.join(process.env.HOME, 'Claude Cowork')`)
- **Vault restructure (PRs #90-93, merged 2026-07-26):** the old flat `RIGHT/` folder is dissolved. `config/vault-paths.json` now lists LEFT (`ABOUT ME`, `Daily`, `Relationships`, `Drafts`) and RIGHT (`memory`, `briefings`, `ctg`, `job-hunt`, `interview-prep`, `content`, `research`, `ideas`, `standups`, `projects`, `maps`, `proposals` + subpaths, `archive`, `inbox`) as top-level vault folders. `/today` briefings now write to `briefings/` (not `RIGHT/`); memory and proposal history moved to `archive/memory` and `archive/proposals` respectively.
- **Two distinct access paths, not one:**
  1. `src/vault-gateway.js` reads/writes vault markdown **directly via Node `fs`**, not through the REST API — it is the single write-enforcement point (LEFT/RIGHT path allowlist against `config/vault-paths.json`, then content-policy + style-policy gates), and watches `config/` for hot-reload via `chokidar`. `src/today-command.js` now routes its briefing writes through `vaultWrite` from `vault-gateway.js` rather than writing the vault directly.
  2. The Obsidian Local REST API plugin + Docker MCP Gateway is the transport Claude Code itself uses to browse/edit the vault interactively from inside a session — this path is not called from anything in `src/`

## MCP Connectors (`src/connectors/`)

**GitHub** (`src/connectors/github.js`):
- Docker MCP Gateway tools: `list_commits`, `list_issues`, `list_pull_requests`
- Scoped to `config/connectors.json` → `github.owner: "UsernameTron"`, `github.repos: ["second-brain"]`
- `list_pull_requests` has no `since` param, so PRs are filtered client-side by `updated_at`
- Partial-failure tolerant: `Promise.allSettled` per tool per repo; returns a `warnings` array unless every call fails

**Gmail** (`src/connectors/gmail.js`):
- MCP server: `gmail-mcp-pete` (a claude.ai connector, not Docker MCP), exposing `list_recent_messages`, `get_message_body`, `create_draft`
- Draft-only by design: no send tool is called and no send-verb function is exported (OAuth scope `gmail.compose`, excludes `gmail.send`)
- Two-layer VIP filtering: server-side `allowedSenders` param from `config/connectors.json` → `gmail.vipSenders` plus a connector-side case-insensitive re-filter

**Google Calendar** (`src/connectors/calendar.js`):
- Transport: Cowork-native MCP tools (`mcp__claude_ai_Google_Calendar__*`), a claude.ai connector, via dependency-injected `mcpClient`
- Read-only by API omission: only `getCalendarEvents` / `getEvent` are exported
- In-connector filters: declined-event filter and a timezone-aware working-hours filter (`config/connectors.json` → `calendar.workingHours: {start:8, end:18}`)
- Supports a `remote` mode for the RemoteTrigger cloud path — currently disabled (see Scheduling below)

Note: `.mcp.json` at the repo root registers only `context7` (Upstash docs MCP for development). Gmail/Calendar/GitHub/Obsidian MCP connections are configured at the Claude Desktop / claude.ai account level, not in repo config.

## Scheduling & Automation (macOS launchd)

- **`com.secondbrain.today`** — not committed to the repo (plist exists only at `~/Library/LaunchAgents/`); documented in `config/scheduling.json`. Runs weekdays 06:45 local, executing the `/today` briefing, now writing through `vault-gateway.js` into `briefings/`.
- **`com.secondbrain.daily-sweep`** — committed at `config/com.secondbrain.daily-sweep.plist`; daily 23:45 local, runs `scripts/daily-sweep.js` (mines inbox + Daily notes + transcripts into memory proposals)
- **`com.secondbrain.dream`** — committed at `config/com.secondbrain.dream.plist`; monthly (Day 1, 07:15 local), runs `node scripts/dream.js --propose` only; sets `LLM_PROVIDER=anthropic` for unattended runs

**Fallback chain** (`config/scheduling.json` `fallback_chain`): macOS launchd (primary) → Claude Desktop `CronCreate` → RemoteTrigger (disabled)

**RemoteTrigger** (disabled by design): its cloud environment cannot reach the local `VAULT_ROOT`, so its `/today` writes would go nowhere reachable.

## Environment Configuration

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic classification/briefing |
| `VOYAGE_API_KEY` | Optional | Semantic embeddings; absent → keyword-only fallback |
| `LM_API_TOKEN` | Optional | Bearer auth to LM Studio when its server requires authentication |
| `VAULT_ROOT` | Optional | Overrides vault path, default `~/Claude Cowork` |
| `PROJECTS_DIR` | Optional | Cross-project GSD state root, default `/Users/cpconnor/projects` |
| `LLM_PROVIDER` | Optional | `=anthropic` forces Anthropic even when config says `provider: local` |
| `CONFIG_DIR_OVERRIDE` / `CACHE_DIR_OVERRIDE` | Test-only | Isolation for config/cache paths in tests |

Secrets live in `.env` (gitignored); shape documented in `.env.template`.

## Cross-Surface Reach (memory export)

- `config/reach-targets.json` lists other Claude Code projects' `memory/` folders on this machine that `src/reach-exporter.js` writes a pointer + digest cache to on every real memory promotion (ADR-019)
- **Egress gate is now fail-closed** (PR #91-93 changeset): the content-policy exclusion check (`src/content-policy.js`) stays closed on any throw during the check, not only on an explicit denial — a policy-check failure blocks export rather than silently passing content through
- `src/content-policy.js` excluded-term matching (`config/excluded-terms.json`) is whole-token: lookaround-based matching requires the match to occupy a full token boundary, preventing false negatives/positives inside longer tokens

## Derived Read Surfaces

- `src/memory-dashboard.js` (new) — regenerates `memory/dashboard.md` whole on every real promotion from `memory/memory.md` + proposals; a human-readable Obsidian view stripped of pipeline bookkeeping (no `content_hash`, no block anchors)

## Vault Hygiene Instrumentation

- `src/daily-stats.js` adds a `vault_hygiene` column to the daily stats row; `src/briefing-helpers.js` reads the prior row's `vault_hygiene` value for trend comparison in the `/today` briefing

## Webhooks & Callbacks

**Incoming:** None — all external data (Gmail, Calendar, GitHub) is pulled on-demand or on a schedule, not pushed via webhook.
**Outgoing:** None.

---

*Integration audit: 2026-07-26*
