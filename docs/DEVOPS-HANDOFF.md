# DevOps Handoff — Second Brain

## Project Summary

Personal operating system built on an Obsidian vault. Runs locally — no cloud hosting, no deployment infrastructure. Three core CLI commands (`/today`, `/new`, `/wrap`) orchestrate memory compounding, daily briefing, and input routing via Claude Code and Docker MCP Gateway.

v1.8 Phase 32 (2026-07-19) adds a retrieval eval harness (`npm run eval:recall`) that scores recall quality over a frozen seed vault against a committed baseline, fully isolated from the live vault and live embeddings cache. v1.7 (2026-07-16) adds compounding evidence metrics to daily briefing, outcome instrumentation (11-column daily-stats), compounding verdict surfaces, and launchd weekday scheduler (com.secondbrain.today, 06:45 local). Semantic memory retrieval via Voyage AI embeddings (`/recall --semantic`, `/recall --hybrid`) added in Phase 19 with graceful degradation to keyword search when the API is unavailable.

## Environment Requirements

- **Obsidian 1.7+** with Local REST API plugin running (port 27123 default)
- **Node.js 22+** (required by the `node:sqlite` built-in; tested in CI)
- **Claude Code CLI** with GSD framework deployed
- **Git**
- **Docker** (for MCP Gateway — Gmail, Calendar, GitHub integrations)

## How to Run

```bash
git clone <repo>
cd second-brain
npm install
printf 'ANTHROPIC_API_KEY=...\n' > .env   # add ANTHROPIC_API_KEY and optionally VOYAGE_API_KEY (no .env.example in repo)
npm test               # 1568 tests across 82 files — locally 1539 passing + 29 skipped; under CI=true 1530 passing + 38 skipped
npm run lint           # verify ESLint 10 clean
```

All commands are Claude Code `/` commands invoked from the project terminal. No server process to start; commands run on-demand.

**Automated daily briefing:** `/today` runs weekdays at 06:45 local time (StartCalendarInterval) via macOS launchd scheduler (`com.secondbrain.today`). See `~/Library/LaunchAgents/com.secondbrain.today.plist` for schedule configuration (documented in `config/scheduling.json`). RemoteTrigger is disabled by design (runs only on local machine wake).

Since 2026-07-31 (PR #96) `scripts/today-scheduled.js` exits **1** when `runToday` resolves an inline error envelope, not just when it rejects. Previously a briefing-less morning exited 0 and launchd logged success — so a non-zero exit in the launchd log is now the signal that no briefing was written. Check the plist's `StandardErrorPath` for the envelope's error text.

**User command surface (full flag inventory in README.md and CLAUDE.md):** `/today` (with compounding section), `/new`, `/wrap`, `/promote-memories`, `/reroute`, `/promote-unrouted`, `/recall <query> [--category <name>] [--since YYYY-MM-DD] [--top N]`, `/recall --semantic <query>`, `/recall --hybrid <query>`, `node scripts/compounding-report.js` (standalone CLI), `npm run eval:recall [-- --baseline]` (retrieval eval, v1.8 Phase 32). The `--category`, `--since`, and `--top N` flags apply uniformly across keyword, semantic, and hybrid recall modes.

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

### Local-model timeout and the Stop-hook budget (2026-07-31)

The operator's machine sets the local timeout to **900000** (15 min), raised from 60000, via `config/pipeline.local.json`. The key is nested — `classifier.llm.localTimeoutMs`, not `llm.localTimeoutMs`:

```json
{ "classifier": { "llm": { "provider": "local", "localModel": "qwen/qwen3.6-27b", "localTimeoutMs": 900000 } } }
```

**A fresh clone does not get this.** `config/*.local.json` is gitignored (`.gitignore:20`) and `config/pipeline.json` ships no `localTimeoutMs`, so with no local overlay `classifyLocal` falls back to its hard-coded `10_000` ms default — not 60000, and not 900000. Write the file with the full nested path or the value is never read.

Why 15 minutes: cold prefill on the local model measures ~86 tokens/sec, so a 49k-token extraction takes ~9.5 min uncached (~26 s on a prompt-cache hit) and generation runs ~6–7 tokens/sec. A 60 s ceiling could not finish a cold extraction chunk at this context size.

That 15-minute ceiling is **not** inherited by hook-driven callers. `classifyLocal` computes its effective timeout as `Math.min(llmConfig.localTimeoutMs, callOptions.timeoutMs ?? Infinity)`, and `.claude/hooks/memory-extraction-hook.js` passes `timeoutMs: 50000` because Claude Code SIGKILLs the Stop hook at 60 s. `classifyAnthropic` honors the same `callOptions.timeoutMs` as the Anthropic SDK per-request `{ timeout }`.

The hook budget is a single **extraction-wide** deadline, not a per-call timeout: each classify gets whatever remains, and once less than 2 s is left chunk processing stops and records a `timeout` failure rather than firing a doomed call. Operator consequence, measured 2026-07-31 — this is not an edge case. At ~86 tok/s cold prefill a 50 s budget covers roughly **4,300 prompt tokens**, so hook-driven local extraction times out on essentially every real transcript and falls back to Haiku. On 2026-07-31 that exhausted the whole `haikuNightlyCap` (50) in a day: `classifier-health.json` showed `consecutive_failures: 6`, `last_failure_code: "timeout"`, `haiku_calls: 50` while LM Studio served normally. LM Studio being healthy is not evidence the hook path works. Re-run `/wrap` from the terminal, where the full 900 s applies. A fix is on the roadmap (route hook extraction straight to Haiku, or bound the hook corpus to what 50 s can prefill).

**Local model prerequisites:** LM Studio serving `qwen/qwen3.6-27b` with loaded context at **65536** (raised from 32768, with flash attention and q8_0 K/V cache quantization; ~16.3 GiB at load on 48 GB unified memory). The setting is persisted in `~/.lmstudio/.internal/user-concrete-model-default-config/qwen/qwen3.6-27b.json` so the server's JIT loads pick it up. At the old 32768 ceiling real extraction requests of 33,315 and 62,968 tokens were rejected with `exceed_context_size_error` + Channel Error.

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

### Rate limits and the dream retrievability gate

Voyage's free tier allows 3 requests/minute. That is below what a full re-embed or a dream-apply gate needs, and the 429s it produced tripped degraded mode. A billing-enabled key is now installed; the health tracker reports 0 consecutive failures.

429s matter more here than in `/recall`, because degradation is **not** uniform across surfaces:

- **`/recall --semantic` / `--hybrid`** — degrade *open*: fall back to keyword search with a banner. Retrieval still answers.
- **`npm run dream:apply`** — degrades *closed*. The apply pass snapshots `memory.md` + the embeddings sidecar + the SQLite index, applies the accepted MERGE/STALE ops, then requires every merged entry to still be retrievable via hybrid search. Blocked or degraded retrieval is treated as a regression, so a 429 storm mid-gate auto-restores the snapshot and reverts the applied ops to unresolved. Nothing is half-applied and nothing is lost — but the run is wasted.

**Operator rule:** confirm `voyage-health.json` shows `consecutive_failures: 0` before invoking `dream:apply`, and do not run it alongside a full re-embed. A clean run reports `evalPassed: true` with no snapshot restore (the 2026-07-31 run applied 4 accepted merges this way).

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
| Unit + integration tests | Jest 30, Node 22 matrix | 1568 total across 82 files; 1530 passing + 38 skipped, 80 of 82 suites run (`CI=true`, 2026-08-19) |
| Branch coverage | Jest coverage | ≥80% enforced (currently 80.95%; statements 92.05%, functions 95.78%, lines 93.01%) |
| Security scan | CodeQL SAST | 0 high/critical |
| Secrets scan | GitGuardian | 0 secrets |
| License check | license-checker | MIT/ISC/Apache/BSD only |

UAT tests (`test/uat/`) are guarded by `CI=true` skip logic and run on a separate schedule (Monday 13:00 UTC) to avoid runner contention. `VOYAGE_API_KEY` is not provisioned in CI — semantic UAT tests use the dual skip guard (`CI=true OR no VOYAGE_API_KEY`).

### Pre-Operations Deployment Checklist

- [ ] `ANTHROPIC_API_KEY` provisioned in `.env`
- [ ] `VOYAGE_API_KEY` provisioned in `.env` (if semantic features are enabled)
- [ ] Obsidian Local REST API plugin running on port 27123
- [ ] Docker MCP Gateway running (for Gmail/Calendar/GitHub connectors)
- [ ] launchd schedulers installed — all three plists are versioned in `config/` and copied to `~/Library/LaunchAgents/`: `com.secondbrain.today` (weekday `/today` 06:45 via `scripts/today-scheduled.js`, dotenv-gated, exits 1 on a briefing-less run), `com.secondbrain.daily-sweep` (23:45 nightly capture), `com.secondbrain.dream` (1st of month 07:15, propose-only, Anthropic-pinned — `dream:apply` is never scheduled). Load with `launchctl bootstrap gui/$(id -u) <plist>`
- [ ] `npm test` passes (1568 tests; 1530 passing + 38 skipped under CI)
- [ ] `npm run lint` exits 0
- [ ] `~/.cache/second-brain/` writable (auto-created on first `/recall --semantic`)

### v1.8 operational surfaces (added 2026-07-21)

- **Dream consolidation (Phase 34):** `npm run dream:propose` stages monthly MERGE/STALE ops to `proposals/dream-changeset-YYYY-MM.md` (also fired by the `com.secondbrain.dream` plist, 1st @ 07:15, `LLM_PROVIDER=anthropic` pinned in the plist). `npm run dream:apply` is human-invoked only — snapshot-first with an `eval:recall` retrievability gate that auto-restores on regression. `npm run verify:baseline` guards the 27 pre-governance memory hashes and runs in the pre-push gate.
- **Proactive memory injection (Phase 35):** `.claude/hooks/session-memory-inject.js` runs at SessionStart — hybrid top-5 recall for a project-derived query, egress-filtered (fail-closed `checkContent`), ~750-token cap, always exits 0. Kill switches: `sessionInject.enabled` in config, `SB_SESSION_INJECT=0` env.
- **Sweep evidence (Phase 33):** every nightly sweep writes `state/daily-sweep-last-run.json` (gitignored); `/today`'s Compounding section renders "sweep ran/STALE/NEVER RAN" from it. Classifier fallback is health-gated: `src/utils/classifier-health.js` caps per-night Haiku calls (`classifier.haikuNightlyCap`).

### Reliability behavior (PR #96, 2026-07-31)

- **Promotion drains in batches of 10.** `/promote-memories` promotes at most `promotion.batchCapMax` (10) accepted candidates per run; the rest stay `deferred` — promotable, not terminal — so a large backlog needs repeated runs. Rejected candidates are archived, never deleted. Clearing the 2026-07-31 backlog took 10 runs: **98 promoted, 405 rejected**, 0 exclusion violations, with 2 synthetic dedup-test fixtures left pending on purpose.
- **Proposal lock reclaim is pid-probed.** `proposals.lock` is reclaimed when stale-by-age **only** if `process.kill(pid, 0)` proves the holder dead (`ESRCH`), or the lock file is corrupt/pid-less. A live holder — including `EPERM`, i.e. alive but another user's — is never stolen. Before this fix a SIGKILLed holder left the lock forever and every later candidate was silently buffered while being reported as staged; the fix released the buffered backlog (reported as 483 candidates by the run that drained it; no pending-buffer artifact survives to re-verify that figure).
- **`/wrap` reports staged vs buffered separately.** Staged counts only results with `written === true && !buffered`; the output reads `N staged, M buffered — run /wrap again to drain`. A non-zero buffered count means run it again, not that extraction failed. `/wrap` still exits non-zero only on a hard extraction failure.
- **A failed directory sweep no longer aborts.** `extractFromFile` wraps the candidate loop so a throw is recorded as an `extraction-error` failure and returns partial results for that file, instead of propagating and killing the whole sweep. Isolation is per **file**, not per candidate — a throw abandons the remaining candidates in that one file, and `extractFromDirectory` moves on to the next file.
- **Config-load failures are visible.** A bad or unreadable `config/excluded-terms.json` used to return `[]`, silently disabling the ingress exclusion gate. It now emits `logDecision('CONFIG', 'excluded-terms.json', 'LOAD_ERROR', …)`. Treat that log line as a P1: exclusions are the ISPN/Genesys/Asana boundary.
- **`npm run eval:recall` gates retrieval code, not live memory.** It scores the frozen `eval/seed-vault/` against `eval/golden-recall.json`, so it is unaffected by live `memory.md` edits. Baseline `eval/baseline-2026-07-19.json` re-verified unchanged on 2026-07-31: keyword recall@5 0.900 / MRR 0.900, semantic 0.800 / 0.800, hybrid 0.900 / 0.900.

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

Local development only. No hosting, no containerization, no remote deployment. v1.8 milestone (in progress) targets measured-memory completeness before any hosting consideration.

**Phase 19 REQ-ID coverage in this document:**

| REQ-ID | Section |
|---|---|
| MEM-EMBED-01 | Environment Variables — VOYAGE_API_KEY |
| MEM-SEMANTIC-01 | Semantic Search Configuration |
| MEM-INDEX-REFRESH-01 | Semantic Search Configuration — Cache invalidation rule |
| MEM-DEGRADE-01 | Degradation Behavior |
