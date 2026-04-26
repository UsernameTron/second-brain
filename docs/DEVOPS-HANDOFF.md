# DevOps Handoff — Second Brain

## Project Summary

Personal operating system built on an Obsidian vault. Runs locally — no cloud hosting, no deployment infrastructure. Three CLI commands (`/today`, `/new`, `/wrap`) orchestrate memory compounding, daily briefing, and input routing via Claude Code and Docker MCP Gateway.

Phase 19 (2026-04-24) adds semantic memory retrieval via Voyage AI embeddings (`/recall --semantic`, `/recall --hybrid`), with graceful degradation to keyword search when the API is unavailable.

## Environment Requirements

- **Obsidian 1.7+** with Local REST API plugin running (port 27123 default)
- **Node.js 20+** (22 LTS recommended; tested matrix in CI)
- **Claude Code CLI** with GSD framework deployed
- **Git**
- **Docker** (for MCP Gateway — Gmail, Calendar, GitHub integrations)

## How to Run

```bash
git clone <repo>
cd second-brain
npm install
cp .env.example .env   # add ANTHROPIC_API_KEY and optionally VOYAGE_API_KEY
npm test               # verify 1127 tests pass (1044 active + 38 CI-skipped + 45 todo)
npm run lint           # verify ESLint 10 clean
```

All commands are Claude Code `/` commands invoked from the project terminal. No server process to start; commands run on-demand.

**User command surface (full flag inventory in README.md and CLAUDE.md):** `/today`, `/new`, `/wrap`, `/promote-memories`, `/reroute`, `/promote-unrouted`, `/recall <query> [--category <name>] [--since YYYY-MM-DD] [--top N]`, `/recall --semantic <query>`, `/recall --hybrid <query>`. The `--category`, `--since`, and `--top N` flags apply uniformly across keyword, semantic, and hybrid recall modes.

## Environment Variables

| Variable | Required | Purpose | Acquisition |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API for Haiku/Sonnet classification and briefing | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `VOYAGE_API_KEY` | Optional | Voyage AI embeddings for `/recall --semantic` and `/recall --hybrid` (MEM-EMBED-01, MEM-SEMANTIC-01). Without this key, semantic/hybrid flags fall back to keyword search with a warning banner. | [voyage.ai](https://dash.voyageai.com) → API Keys → Create new key |

### VOYAGE_API_KEY — Acquisition and Rotation

1. Sign up at [dash.voyageai.com](https://dash.voyageai.com)
2. Create a new API key (project scope sufficient)
3. Add to `.env`: `VOYAGE_API_KEY=your_key_here`
4. Verify: `VOYAGE_API_KEY=your_key node -e "const {VoyageAIClient}=require('voyageai');console.log('ok')"`

**Rotation:** Generate a new key in the Voyage dashboard, update `.env`, restart any long-running Claude Code session. No other process caches the key — it is read fresh on each `/recall --semantic` invocation.

**Scope:** The key is only used for embedding generation — no data is stored on Voyage's servers beyond the request/response cycle.

## Configuration

### Config Files

All config lives in `config/` with optional `.local.json` overlays for dev tuning:

| File | Purpose |
|---|---|
| `config/pipeline.json` | Classifier thresholds, extraction, promotion, retry, semantic tunables |
| `config/connectors.json` | MCP connector registry (Gmail, Calendar, GitHub) |
| `config/scheduling.json` | Cron schedule for `/today` |
| `config/excluded-terms.json` | Hard-block ingress list (ISPN, Genesys, Asana, etc.) |
| `config/vault-paths.json` | LEFT/RIGHT vault boundary definitions |
| `config/templates.json` | Domain templates and memory categories |

To override for local dev: create `config/pipeline.local.json` with only the keys to override. The overlay pattern (`loadConfigWithOverlay`) merges it on top of the base config.

### Semantic Search Configuration (Phase 19)

The `memory.semantic` block in `config/pipeline.json` controls all Phase 19 behavior (MEM-SEMANTIC-01):

| Key | Default | Range | Purpose |
|---|---|---|---|
| `memory.semantic.model` | `"voyage-4-lite"` | AJV enum | Voyage AI embedding model. Changing this invalidates the cache (triggers full re-embed on next `/recall --semantic`). |
| `memory.semantic.threshold` | `0.55` | 0.0–1.0 | Cosine similarity cutoff. Results below this score are excluded. Applied at query time — does NOT invalidate embeddings. Calibrated empirically against `voyage-4-lite`: top relevance hits land at 0.55–0.70 against typical query phrasings; spec'd 0.72 was empirically too strict and surfaced zero results during Phase 19 UAT. |
| `memory.semantic.recencyDecay` | `0.2` | 0.0–1.0 | Temporal boost weight. Higher = stronger recency preference. Applied at query time — does NOT invalidate embeddings. |
| `memory.semantic.rrfK` | `60` | ≥1 | RRF k constant for hybrid fusion. Controls how aggressively rank differences are penalized. |
| `memory.semantic.candidatesPerSource` | `20` | 1–200 | Top-N candidates fetched from each source (keyword + semantic) before RRF merge. |
| `memory.semantic.embedBatchSize` | `128` | 1–128 | Maximum entries per Voyage API embed call. Lower this if hitting payload limits. |
| `memory.semantic.timeoutMs` | `3000` | ≥100 | Voyage API request timeout in milliseconds. |
| `memory.semantic.degradedModeMinutes` | `15` | ≥1 | Window length (minutes) for degraded mode after 3 consecutive Voyage failures (MEM-DEGRADE-01). |
| `memory.semantic.embeddingDim` | `1024` | AJV enum | Vector dimension. Must match model output. Changing this (along with model) invalidates the cache. |

**Cache invalidation rule:** Only `model` + `embeddingDim` affect `schema_version`. Changing `threshold`, `recencyDecay`, `rrfK`, or other query-time params does NOT require re-embedding (MEM-INDEX-REFRESH-01).

## Cache and Disk Artifacts (Phase 19)

Phase 19 introduces a local cache at `~/.cache/second-brain/` for embedding persistence.

### Cache Directory

| Path | Default | Override |
|---|---|---|
| `~/.cache/second-brain/` | OS home dir | `CACHE_DIR_OVERRIDE` env var (for test isolation) |

**Permissions:** Directory `0700`, all files `0600`. Created automatically on first `/recall --semantic` call.

### Cache Files

| File | Purpose | Retention |
|---|---|---|
| `embeddings.jsonl` | One JSON line per memory entry: `{hash, embedding, addedAt, category}`. Hash is SHA-256 of entry content. | Permanent — only invalidated when `schema_version` changes (model or embeddingDim change). |
| `index-metadata.json` | `{schema_version, updatedAt}`. Compared on startup to detect stale embeddings. | Permanent — updated on each index refresh. |
| `voyage-health.json` | `{consecutive_failures, last_failure, last_failure_code, degraded_until}`. Tracks API health across CLI invocations. | Ephemeral — reset on any successful Voyage call. |

### Size Estimate

~4 KB per entry (1024-dimension float32 vector encoded as JSON). A 500-entry vault generates approximately 2 MB of embeddings.

### Backup Policy

**Backup is NOT required.** The cache is entirely regeneratable from `memory.md` via the self-heal path on next `/recall --semantic` call. No sensitive data is stored in the cache — only vectors and metadata.

**Cleanup:** Delete `~/.cache/second-brain/` to force full re-embed on next invocation. Safe to do at any time.

## Degradation Behavior (MEM-DEGRADE-01)

Phase 19 implements Pattern 7 (Adaptive Denial Tracking) for Voyage API failures.

### Degradation Trigger

3 consecutive Voyage API failures of any type (401, 429, 5xx, ETIMEDOUT, ENOTFOUND) trip degraded mode.

### Degraded Mode Behavior

- Window: 15 minutes (configurable via `memory.semantic.degradedModeMinutes`)
- During the window: all `/recall --semantic` and `/recall --hybrid` calls skip Voyage and fall back to keyword search
- User-facing banner appended to `/recall` output:
  - `(semantic unavailable — using keyword only)` for `--semantic`
  - `(hybrid unavailable — using keyword only)` for `--hybrid`
- State persisted in `~/.cache/second-brain/voyage-health.json` — coordinates across separate CLI invocations

### Recovery

One successful Voyage API call resets `consecutive_failures` to 0 and clears `degraded_until`. No manual intervention required.

### Operator Diagnostics

```bash
# Check current health state
cat ~/.cache/second-brain/voyage-health.json

# Force recovery (delete health file)
rm ~/.cache/second-brain/voyage-health.json

# Check error type (stderr on degraded calls)
VOYAGE_API_KEY=your_key node -e "require('./src/semantic-index').semanticSearch('test').then(console.log)"
```

If `consecutive_failures >= 3` and `degraded_until` is in the future: the system is in degraded mode. Check `last_failure_code` for the failure class (401 = bad key, 429 = rate limit, 5xx = Voyage service issue).

## Security Notes

- `context/` and `state/` directories are gitignored (private identity data — never commit)
- `.env` is gitignored — never commit API keys
- `VOYAGE_API_KEY` is read fresh on each invocation — no in-process caching across sessions
- `embeddings.jsonl` is chmod 0600 — contains vector representations of memory content (no raw text, but semantically meaningful)
- OAuth scopes: Gmail `gmail.compose` (draft-only, no send), Calendar read-only, GitHub issues-only
- All ingress filtered by `content-policy.js` — ISPN, Genesys, Asana terms hard-blocked before any API call

## CI/CD

Local-only project — no cloud deployment. CI pipeline via GitHub Actions:

| Gate | Tool | Threshold |
|---|---|---|
| Lint | ESLint 10 (flat config) | 0 errors |
| Unit + integration tests | Jest 30, Node 20+22 matrix | 1127 total, 1044 passing |
| Branch coverage | Jest coverage | ≥81% enforced |
| Security scan | CodeQL SAST | 0 high/critical |
| Secrets scan | GitGuardian | 0 secrets |
| License check | license-checker | MIT/ISC/Apache/BSD only |

UAT tests (`test/uat/`) are guarded by `CI=true` skip logic and run on a separate schedule (Monday 13:00 UTC) to avoid runner contention. `VOYAGE_API_KEY` is not provisioned in CI — semantic UAT tests use the dual skip guard (`CI=true OR no VOYAGE_API_KEY`).

### Post-Phase-19 Deployment Checklist

- [ ] `ANTHROPIC_API_KEY` provisioned in `.env`
- [ ] `VOYAGE_API_KEY` provisioned in `.env` (if semantic features are enabled)
- [ ] Obsidian Local REST API plugin running on port 27123
- [ ] Docker MCP Gateway running (for Gmail/Calendar/GitHub connectors)
- [ ] `npm test` passes (1127 tests, 1044 passing)
- [ ] `npm run lint` exits 0
- [ ] `~/.cache/second-brain/` writable (auto-created on first `/recall --semantic`)

## Known Tech Debt and Deferred Work

Phase 21 (Closeout Hygiene, v1.4) shipped the JSDoc, no-console, and Unicode-gap items below. Remaining deferred items:

| ID | Item | Status / Target |
|---|---|---|
| HYG-JSDOC-01 | JSDoc on public API surface (incl. Phase 19 `semantic-index.js`, `voyage-health.js`) | Shipped Phase 21 (53 exports + 2 `_testOnly` carve-outs, PR #43) |
| HYG-CONSOLE-01 | 32 no-console warnings across `src/` (originally tracked as 41 in v1.3 backlog drift; corrected during Phase 21 manifest re-count) | Shipped Phase 21 (32 primary + 3 corollary disables, all category-tagged per D-LOCK-2, PR #44) |
| HYG-UNICODE-01 | ASCII-only excluded-term matching documented as the v1.4 contract; Unicode-variant catching deferred to v1.5 HYG-UNICODE-02 (45 test.todo entries staged) | Shipped Phase 21 (Path B per D-LOCK-5-AMEND-A, PR #42) |
| HYG-UNICODE-02 | Unicode-variant excluded-term matching (full-width Latin, soft-hyphen-injected, non-ASCII whitespace) | v1.5 (`tasks/todo.md`) |
| FUT-HNSW-01 | HNSW approximate nearest-neighbor index for vaults >20K entries (linear scan adequate for current scale) | Future milestone |
| FUT-RERANK-01 | Cross-encoder reranking pass after RRF fusion (RRF adequate for v1.4) | Future milestone |

## Deployment Maturity

Local development only. No hosting, no containerization, no remote deployment. v1.4 milestone (in progress) targets full local feature completeness before any hosting consideration.

**Phase 19 REQ-ID coverage in this document:**

| REQ-ID | Section |
|---|---|
| MEM-EMBED-01 | Environment Variables — VOYAGE_API_KEY |
| MEM-SEMANTIC-01 | Semantic Search Configuration |
| MEM-INDEX-REFRESH-01 | Semantic Search Configuration — Cache invalidation rule |
| MEM-DEGRADE-01 | Degradation Behavior |
