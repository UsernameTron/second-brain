# v1.4 Requirements

**Milestone:** v1.4 Memory Activation & Final Closeout
**Defined:** 2026-04-24
**Source:** Plan at `~/.claude/plans/shimmying-watching-fairy.md` + `.planning/research/SUMMARY.md`

All requirements are user-centric (or developer-centric where the "user" is the DevOps consumer). REQ-IDs are atomic, testable, and map 1:1 to success criteria in the phase plans.

---

## Milestone v1.4 Requirements

### CI / Infrastructure (Phase 17)

- [ ] **UAT-CI-01**: A scheduled GitHub Actions workflow runs `npm run test:uat:ci` on a weekly cron and on manual `workflow_dispatch`, with the `ANTHROPIC_API_KEY` exposed via GitHub secrets to that job only.
- [ ] **UAT-CI-02**: Each UAT run uploads the test accuracy report as a GitHub Actions artifact retained for 90 days, so accuracy trend can be inspected by opening the workflow run.
- [ ] **BRANCH-PROT-01**: Branch protection on `master` enforces passing CI (lint, tests, coverage, CodeQL) and blocks force-push. UAT workflow is informational, not required.

### Memory Retrieval Foundation (Phase 18)

- [ ] **MEM-READ-01**: `readMemory()` parses `memory/memory.md` into structured entries `{ id, category, content, date, sourceRef, contentHash }` and returns an empty array when the file is missing (never throws).
- [ ] **MEM-SEARCH-KW-01**: `searchMemoryKeyword(query, options)` returns ranked entries using `minisearch` with AND semantics, quoted-phrase support (`"exact"`), negation (`-term`), category filter, date-range filter, and 100-character snippets.
- [ ] **RECALL-CMD-01**: User can run `/recall <query>` from Claude Code. It returns up to N results (default 5) as a numbered list with category, snippet, and source-ref. Flags: `--category`, `--since`, `--top N`.
- [ ] **TODAY-ECHO-01**: `/today` briefing includes a "Memory Echo" section between Frog and Pipeline showing 3–5 memory entries keyword-matched against today's calendar topics and VIP email subjects. The section is omitted entirely when no entry exceeds the 0.65 relevance threshold (configurable in `config/pipeline.json`).

### Semantic Memory Search (Phase 19)

- [ ] **MEM-EMBED-01**: `indexNewEntries(promoted)` runs inside `/promote-memories` after `appendToMemoryFile()`. For each new entry it calls Voyage AI (`voyage-4-lite`) via the `voyageai@0.2.1` SDK and appends `{ hash, embedding, addedAt, category }` to `~/.cache/second-brain/embeddings.jsonl`. Entries whose `contentHash` is already indexed are skipped (no re-embedding).
- [ ] **MEM-SEMANTIC-01**: `semanticSearch(query, k=5)` embeds the query with `input_type: "query"`, scores against stored vectors via cosine similarity with temporal decay (`adjusted = base * (1 + 0.2 * recency)`), filters by the 0.72 threshold, returns top-k entries. Before embedding, the query is filtered through the existing excluded-terms policy to prevent ISPN/Genesys/Asana leakage to Voyage.
- [ ] **MEM-INDEX-REFRESH-01**: On startup, `semantic-index.js` compares the set of `contentHash` values in `memory.md` against those in `embeddings.jsonl`. Mismatches trigger lazy re-embed for the missing/stale hashes only. A `schema_version` field in `~/.cache/second-brain/index-metadata.json` triggers a full re-embed when the stored version differs from the code version.
- [ ] **MEM-DEGRADE-01**: When Voyage is unreachable (timeout, 429, 5xx, DNS failure) or `VOYAGE_API_KEY` is absent, `/recall --semantic` and `/recall --hybrid` fall back to keyword search and emit a one-line degradation notice. Memory Echo continues using keyword match with no error surfaced in the briefing.

### Value Extraction Instrumentation (Phase 20)

- [ ] **STATS-DAILY-01**: `appendDailyStats()` writes one row per calendar day to `~/Claude Cowork/RIGHT/daily-stats.md` with columns `date | proposals | promotions | total_entries | memory_kb | recall_count | avg_latency_ms | avg_confidence`. Second run on the same day updates the existing row rather than appending a duplicate (idempotency).
- [ ] **STATS-LATENCY-01**: `today-command.js` records end-to-end `/today` latency plus per-connector latency (calendar, gmail, github) and per-operation latency (semanticSearch, memoryEcho). Stats row captures `avg_latency_ms` across those operations.
- [ ] **STATS-GROWTH-01**: Memory growth measured as `memory_kb` (size in KB) and `total_entries` (count of `### ` headers), recorded per day. A 7-day trend line shows whether memory is compounding. All date handling uses the user's local timezone (`America/Los_Angeles`) via a single shared `dateKey()` utility and is unit-tested at 23:59 and 00:01.
- [ ] **TODAY-SUMMARY-01**: `/today` output includes a one-line "Yesterday: +N proposals, +M promotions, +X KB memory" summary at the top of the briefing, pulled from the previous day's row in `daily-stats.md`.

### Closeout Hygiene (Phase 21)

- [ ] **HYG-UNICODE-01**: `test/content-policy.test.js` includes tests that exercise the exclusion filter against Unicode variants (curly quotes, em-dashes, smart apostrophes, non-ASCII whitespace) of each excluded term, verifying substring matching still catches them.
- [ ] **HYG-JSDOC-01**: Every public function exported from `src/classifier.js`, `src/memory-extractor.js`, `src/memory-proposals.js`, `src/promote-memories.js`, `src/memory-reader.js`, `src/semantic-index.js`, `src/recall-command.js`, `src/daily-stats.js`, `src/today-command.js`, and `src/vault-gateway.js` has JSDoc with `@param`, `@returns`, and a one-line description.
- [ ] **HYG-CONSOLE-01**: The 41 `no-console` ESLint warnings are resolved by a single decision (logger abstraction OR documented `eslint-disable` with rationale per call site), executed once across the codebase.
- [ ] **DOCS-FINAL-01**: `CLAUDE.md`, `README.md`, and `docs/DEVOPS-HANDOFF.md` accurately reflect v1.4 state — new commands (`/recall`), new env vars (`VOYAGE_API_KEY`), new config keys (`memory.*`, `stats.*`), new artifacts (`daily-stats.md`, `~/.cache/second-brain/embeddings.jsonl`), and final test/coverage numbers.

---

## Future Requirements (deferred beyond v1.4)

| ID | Description | Reason |
|----|-------------|--------|
| FUT-HNSW-01 | HNSW vector index to replace exhaustive cosine | Triggers at >20K entries; not relevant in 2026 for single-user vault |
| FUT-RERANK-01 | LLM re-ranking of top-k semantic results | RRF hybrid is adequate for v1.4; revisit if precision drops |
| FUT-LOCAL-EMBED-01 | Local embedding model (sentence-transformers / llama.cpp) | Zero-cloud posture not worth 400 MB+ model + Python dep |
| FUT-RECALL-TUI-01 | Interactive TUI for `/recall` | Numbered list is sufficient; TUI breaks non-TTY contexts |
| FUT-MEMORY-AWARE-NEW-01 | `/new` consults memory during classification | Risk to working behavior; wait until memory retrieval is proven in v1.4 use |

---

## Out of Scope (explicit exclusions)

- **Real-time embedding on `/recall`** — 2–5 s Voyage API latency per query. Embed at promotion time instead.
- **`/new` becoming memory-aware** — user decision: keep `/new` behaviorally untouched for v1.4 to avoid regression risk on a working classifier. FUT-MEMORY-AWARE-NEW-01 tracks the option for a future milestone.
- **Storing embeddings inside the vault** — `~/Claude Cowork/memory/.index/` would cause iCloud Sync conflicts, chokidar watcher pollution, and vault-search index noise. Use `~/.cache/second-brain/` (XDG cache convention).
- **Chokidar-triggered re-indexing** — creates a thrash loop with `/promote-memories`. Re-index is explicitly triggered inside the promotion path only.
- **Voyage data retention** — account-level opt-out is a prerequisite to v1.4, not an ongoing feature.
- **`voyage-3-lite` / `voyage-3` models** — different embedding space from voyage-4 family; would force full re-embed to upgrade. Use `voyage-4-lite` day one.

---

## Traceability

| REQ-ID | Phase | Status | Plan |
|--------|-------|--------|------|
| UAT-CI-01 | 17 — UAT CI Infrastructure | Pending | TBD |
| UAT-CI-02 | 17 — UAT CI Infrastructure | Pending | TBD |
| BRANCH-PROT-01 | 17 — UAT CI Infrastructure | Pending | TBD |
| MEM-READ-01 | 18 — Memory Retrieval Foundation | Pending | TBD |
| MEM-SEARCH-KW-01 | 18 — Memory Retrieval Foundation | Pending | TBD |
| RECALL-CMD-01 | 18 — Memory Retrieval Foundation | Pending | TBD |
| TODAY-ECHO-01 | 18 — Memory Retrieval Foundation | Pending | TBD |
| MEM-EMBED-01 | 19 — Semantic Memory Search | Pending | TBD |
| MEM-SEMANTIC-01 | 19 — Semantic Memory Search | Pending | TBD |
| MEM-INDEX-REFRESH-01 | 19 — Semantic Memory Search | Pending | TBD |
| MEM-DEGRADE-01 | 19 — Semantic Memory Search | Pending | TBD |
| STATS-DAILY-01 | 20 — Value Extraction Instrumentation | Pending | TBD |
| STATS-LATENCY-01 | 20 — Value Extraction Instrumentation | Pending | TBD |
| STATS-GROWTH-01 | 20 — Value Extraction Instrumentation | Pending | TBD |
| TODAY-SUMMARY-01 | 20 — Value Extraction Instrumentation | Pending | TBD |
| HYG-UNICODE-01 | 21 — Closeout Hygiene | Pending | TBD |
| HYG-JSDOC-01 | 21 — Closeout Hygiene | Pending | TBD |
| HYG-CONSOLE-01 | 21 — Closeout Hygiene | Pending | TBD |
| DOCS-FINAL-01 | 21 — Closeout Hygiene | Pending | TBD |
