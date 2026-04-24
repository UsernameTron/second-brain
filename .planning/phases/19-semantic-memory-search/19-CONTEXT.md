# Phase 19: Semantic Memory Search - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Add Voyage AI semantic retrieval to `/recall`, an RRF-based hybrid mode combining keyword + semantic ranks, and graceful degradation when Voyage is unavailable. Build on the Phase 18 read path (`src/memory-reader.js`, `src/recall-command.js`). Embed at promotion time only — never on `/recall`, never via chokidar. No changes to `/new`.

Deliverables: `src/semantic-index.js` (new), extensions to `src/promote-memories.js` (embed call), extensions to `src/recall-command.js` (`--semantic` / `--hybrid` flags), `pipeline.json` schema additions for `memory.semantic.*`, degraded-mode health tracking in `~/.cache/second-brain/voyage-health.json`.

</domain>

<decisions>
## Implementation Decisions

### Pre-Locked (v1.4 / REQUIREMENTS.md — not re-opened in discussion)
- **D-PRE-01:** Voyage AI provider via `voyageai@0.2.1` SDK, model `voyage-4-lite`. Env var `VOYAGE_API_KEY`.
- **D-PRE-02:** Embed-on-promotion inside `/promote-memories` only. No chokidar re-indexing, no `/recall`-time embedding of stored entries.
- **D-PRE-03:** Storage at `~/.cache/second-brain/embeddings.jsonl` + `~/.cache/second-brain/index-metadata.json` (XDG cache). Never inside the Obsidian vault.
- **D-PRE-04:** Scoring = cosine + temporal decay `adjusted = base * (1 + 0.2 * recency)`, threshold 0.72.
- **D-PRE-05:** Excluded-terms policy runs on the query BEFORE any Voyage call — ISPN/Genesys/Asana never leave the process. Enforced at ingress, not a config flag (Pattern 11).
- **D-PRE-06:** Exhaustive cosine (no HNSW), no LLM re-rank. See FUT-HNSW-01, FUT-RERANK-01 in REQUIREMENTS.md.
- **D-PRE-07:** `/new` command behavior is untouched for v1.4 (FUT-MEMORY-AWARE-NEW-01 deferred).

### Startup Self-Heal
- **D-01:** Hash-set comparison + re-embed runs **lazy on first `/recall --semantic` or `--hybrid` call per process**. Keyword-only `/recall` pays zero Voyage cost. Aligns with Pattern 12 (lazy prompt loading) — work deferred until required.
- **D-02:** Missing entries embedded in **batches up to 128 per Voyage API call** (Voyage's stated max). One API call covers most promotion spikes.
- **D-03:** On partial batch failure: write any successful embeddings to `embeddings.jsonl` immediately, retry the failed subset exactly once, then fall through to keyword results for this invocation. Next `/recall --semantic` tries again.

### RRF Hybrid Fusion
- **D-04:** `score(doc) = 1/(60 + rank_keyword) + 1/(60 + rank_semantic)`. k=60 per Cormack/Clarke 2009. Equal weights.
- **D-05:** Pull **top-20 from each side** before fusion. Return top-N (default 5).
- **D-06:** Dedupe by entry `id` (contentHash). If a doc appears in both ranked lists, **sum** its two reciprocal ranks (standard RRF, rewards cross-source agreement). Tie-break on raw semantic score.

### Voyage Error Handling
- **D-07:** **401 / missing `VOYAGE_API_KEY`** → loud stderr warning with remediation text ("Set VOYAGE_API_KEY or run /recall without --semantic"). No retry. Fallback to keyword. This is a config bug that must be visible.
- **D-08:** **429 rate-limit** → honor `Retry-After` header. If header ≤ 2 seconds, sleep and retry once. If > 2 seconds, skip retry, fallback immediately. Total retry budget per `/recall` invocation: 3 seconds.
- **D-09:** **5xx / timeout / DNS failure** → quiet one-line degradation notice in output, fallback to keyword. No stderr noise (transient).
- **D-10:** **Cross-invocation denial tracking** via `~/.cache/second-brain/voyage-health.json`. After 3 consecutive failed semantic calls, enter "degraded mode" which skips Voyage entirely for 15 minutes and prints a one-line banner on every `/recall`. First successful call clears the counter. Pattern 7 — threshold triggers strategy change, not just an alert.

### Config Surface
- **D-11:** All tunable knobs live in `config/pipeline.json` under `memory.semantic.*`:
  - `model` (enum; default `voyage-4-lite`)
  - `threshold` (default 0.72)
  - `recencyDecay` (default 0.2)
  - `rrfK` (default 60)
  - `embedBatchSize` (default 128; max 128)
  - `timeoutMs` (default 3000)
  - `degradedModeMinutes` (default 15)
  - `candidatesPerSource` (default 20)
- **D-12:** Schema-validated via AJV; overlay-compatible (`pipeline.local.json` can override for dev).
- **D-13:** `VOYAGE_API_KEY` stays **env-only**. Never in config file. Never logged.
- **D-14:** `schema_version` = `hash(model || dimension)` only. Threshold and recency decay are query-time scoring math; changing them does NOT require re-embedding. Re-embed is only triggered by model swap or dimension change.

### Claude's Discretion
Claude may decide without further user input:
- Exact wording of the degradation notice (`(keyword mode — semantic unavailable)` or similar; short, no emojis, no jargon)
- Internal module layout inside `src/semantic-index.js` (single file vs a `src/semantic/` directory; pick whichever stays under 300 LOC)
- JSDoc style (inherit from `memory-reader.js` pattern)
- How the `--semantic` / `--hybrid` CLI flags parse (mirror existing `--category` / `--since` / `--top` style in `recall-command.js`)
- Test fixture structure with nock@14 (mock-only in CI; Claude decides fixture organization)

### Folded Todos
None — no pending todos matched Phase 19 scope.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` §"Semantic Memory Search (Phase 19)" — REQs MEM-EMBED-01, MEM-SEMANTIC-01, MEM-INDEX-REFRESH-01, MEM-DEGRADE-01 with acceptance criteria
- `.planning/REQUIREMENTS.md` §"Out of Scope" — explicit exclusions (real-time embedding, vault storage, chokidar re-index)
- `.planning/REQUIREMENTS.md` §"Future Requirements" — FUT-HNSW-01, FUT-RERANK-01, FUT-LOCAL-EMBED-01 define what v1.4 explicitly defers
- `.planning/ROADMAP.md` §"Phase 19" — success criteria (5 items, all must be TRUE)
- `.planning/STATE.md` §"Milestone v1.4 Locked Decisions" — Voyage provider, `/new` untouched, keyword+semantic both ship

### Research (v1.4 kickoff research — MANDATORY read)
- `.planning/research/SUMMARY.md` — executive summary of Voyage / vector indexing research
- `.planning/research/STACK.md` — library choices (voyageai, minisearch) with versions and rationale
- `.planning/research/ARCHITECTURE.md` — embedding cache topology, memory pipeline integration points
- `.planning/research/PITFALLS.md` — known failure modes and defenses
- `.planning/research/FEATURES.md` — feature table stakes by phase

### Phase 18 outputs (build-on-top)
- `.planning/phases/18-memory-retrieval-foundation/18-CONTEXT.md` — decisions that shaped the read path
- `src/memory-reader.js` — `readMemory()`, `searchMemoryKeyword()`, `getMemoryEcho()` that Phase 19 wires into
- `src/recall-command.js` — existing `runRecall()` / `parseRecallArgs()` that gain `--semantic` and `--hybrid` flags
- `src/utils/memory-utils.js` — `computeHash()`, `sourceRefShort()` (reuse)
- `src/promote-memories.js` §`appendToMemoryFile` — insertion point for embed-on-promotion

### Project principles
- `/Users/cpconnor/projects/second-brain/CLAUDE.md` — LEFT/RIGHT boundary rule, no ISPN/Genesys/Asana in memory surface
- `state/pattern-context.md` — active KB v2.1 patterns: P2 (Zero-Trust), P5 (Dual-Position Context), P7 (Adaptive Denial Tracking), P11 (Feature Flags as Perimeters), P12 (Lazy Prompt Loading). Each pattern's "project application" section names specific Phase 19 applications.
- `tasks/lessons.md` — learned rules from v1.0–v1.3 (config overlay, hook scope, testing discipline)

### External (RFC / API reference — agent researches as needed)
- Voyage AI API docs (`voyage-4-lite`, embed endpoint, `input_type` parameter, quotas) — fetch via Context7 or WebFetch during research phase
- Cormack & Clarke 2009 — "Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods" (RRF k=60 origin)

### Schemas to extend
- `config/schema/pipeline.schema.json` — add `memory.semantic` sub-object with the 8 tunables listed in D-11, all required fields with defaults, enum on `model`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/memory-reader.js`**: `readMemory()` returns `{id, category, content, date, sourceRef, contentHash}` — the exact shape semantic-index needs for hash-set comparison. Reuse verbatim.
- **`src/utils/memory-utils.js` `computeHash()`**: identical hash function must be used on both sides of the memory.md ↔ embeddings.jsonl comparison or hash-set compare breaks.
- **`src/content-policy.js`** (exclusion terms): query-filter pipeline already exists. Wrap semantic query through the same filter BEFORE calling Voyage.
- **`src/pipeline-infra.js` `loadConfigWithOverlay()`**: config loader with AJV validation + `.local.json` overlay. `memory.semantic.*` block plugs straight in.
- **nock@14.0.13** (pre-installed Phase 17): HTTP mocking for Voyage API in unit tests. No additional test infrastructure needed.
- **minisearch@^7.2.0** (Phase 18): already indexes memory for keyword side of `--hybrid`. No duplication.

### Established Patterns
- **Config overlay + AJV schema validation**: every tunable goes through `loadConfigWithOverlay('pipeline', {validate: true})`. No hardcoded constants outside `src/semantic-index.js` defaults that mirror schema defaults.
- **Vault-gateway LEFT/RIGHT boundary**: embeddings live in `~/.cache/`, never in vault. Don't invent a new write location — the cache-path convention is project-wide.
- **`/new`-untouched discipline**: every semantic change routes through `/recall` or `/promote-memories`. `/new` must not gain a dependency on `src/semantic-index.js`.
- **Frontmatter field parsing** (`_parseFields` in memory-reader.js): source of truth for `category`, `date`, `sourceRef` — use the same parse in semantic-index, do not reimplement.
- **ISO date + timezone handling** (`todayString()`, `nowISO()` in promote-memories.js): reuse for `addedAt` in embeddings.jsonl.

### Integration Points
- **`/promote-memories` embed hook**: after `appendToMemoryFile()` succeeds, call `indexNewEntries(promoted)`. If that throws, the promotion itself still succeeded — embed failure is non-fatal (write a warning to voyage-health.json, surface next /recall).
- **`/recall` flag parsing**: extend `parseRecallArgs()` with `--semantic` and `--hybrid`. Current flag pattern is positional-query-plus-named-flags; stay consistent.
- **`/today` Memory Echo (Phase 18 `getMemoryEcho()`)**: per MEM-DEGRADE-01, /today continues to use keyword match. Do NOT wire semantic into Memory Echo for Phase 19 — that's deferred/out-of-scope.
- **`~/.cache/second-brain/` directory**: create if missing, chmod 0700 (user-only). Contains embeddings.jsonl, index-metadata.json, voyage-health.json.

</code_context>

<specifics>
## Specific Ideas

- **Degraded-mode banner** should look like `(semantic unavailable — using keyword only)` at the TOP of `/recall` output, not buried at the bottom. One line. No emoji. No stack trace.
- **401 warning** should include the remediation inline: `WARNING: VOYAGE_API_KEY is not set or invalid. Set it in .env or drop --semantic from your query. Falling back to keyword search.` — to stderr, so it doesn't corrupt stdout parsing.
- **voyage-health.json schema**: `{consecutive_failures: int, last_failure: ISO8601, last_failure_code: "401"|"429"|"5xx"|"timeout"|"network", degraded_until: ISO8601|null}`. Human-readable, 7 lines max.

</specifics>

<deferred>
## Deferred Ideas

### Deferred to Phase 20
- **Per-source rank logging for fusion telemetry** — Phase 20 STATS-LATENCY-01 adds per-operation latency (semanticSearch, memoryEcho). That's the right home for RRF quality metrics too. Phase 19 should emit the raw data; Phase 20 wires it into daily-stats.md.

### Deferred to Phase 21 or later
- **Progress UX during first lazy re-embed** — if a user promotes 40 entries and then runs `/recall --semantic` for the first time, one Voyage batch call takes ~1–2 seconds. Acceptable without progress UI. If vault grows to 1K+ entries, revisit.
- **Configurable RRF weights per-source** — Phase 20 telemetry may surface that semantic should be weighted 1.5x. Ship equal weights in v1.4; tune in a future milestone once there's data.

### Potentially out-of-scope
- **Query caching** (same `--semantic "leadership"` twice in a row hits Voyage twice) — would be a nice latency win but adds cache-invalidation complexity. Not required by any v1.4 REQ. Leave for FUT-* if Phase 20 shows repeat queries are common.

### Reviewed Todos (not folded)
None — no todos were matched to Phase 19.

</deferred>

---

*Phase: 19-semantic-memory-search*
*Context gathered: 2026-04-24*
