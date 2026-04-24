# v1.4 Research Synthesis

**Project:** Second Brain — v1.4 Memory Activation & Final Closeout
**Domain:** Memory retrieval + semantic search layer on an established PKM pipeline
**Researched:** 2026-04-24
**Confidence:** HIGH across all four research files

---

## Executive Summary

v1.4 closes the final gap in the Second Brain: the memory pipeline has been write-only across v1.0–v1.3. This milestone activates the read path — keyword retrieval, Voyage AI semantic search, a morning Memory Echo section in `/today`, and append-only instrumentation that makes the "memory compounds daily" promise visible and measurable.

The recommended approach builds sequentially from a stable foundation: `memory-reader.js` (Phase 18) enables keyword search and `/recall`; `semantic-index.js` using `voyageai@0.2.1` and an in-memory `Float32Array` cosine index stored at `~/.cache/second-brain/embeddings.jsonl` (outside the vault) enables Phase 19 semantic retrieval; `daily-stats.js` writing to `RIGHT/daily-stats.md` enables Phase 20 growth instrumentation. All new modules are flat in `src/`, all write directly via `fs` bypassing `vault-gateway.js` (consistent with the `promote-memories.js` precedent), and all degrade gracefully when Voyage is unavailable.

Top risks: (1) cost runaway from re-embedding the full corpus on each run rather than caching by content hash; (2) query privacy — the existing exclusion filter must be applied to `/recall` query text before any Voyage API call; (3) timezone boundary bugs that duplicate or misdate `daily-stats.md` rows; (4) UAT tests calling the live Voyage API in CI. All four have concrete prevention strategies that must be implemented in-phase, not retrofitted.

---

## Key Findings

### Stack Additions

```
npm install voyageai minisearch
npm install -D nock
```

Vector store: `Float32Array` cosine similarity — zero new production dependency.

| Package | Version | Purpose | Rationale |
|---------|---------|---------|-----------|
| `voyageai` | 0.2.1 | Voyage AI embeddings | Official SDK; CJS at `./dist/cjs/`; 3.5 MB; `node-fetch ^2.7.0` internal |
| `minisearch` | 7.2.0 | Inverted-index keyword search | CJS; 876 KB; zero runtime deps; supports AND, phrase, prefix, field boosting |
| `nock` | 14.0.13 (dev) | HTTP mock for Voyage API in Jest | `http` module level; compatible with voyageai's node-fetch; Node ≥18.20.0 (matrix satisfies) |

**Rejected:** `@lancedb/lancedb` (111 MB install, apache-arrow peer dep conflict at v18.1.0 vs registry v21.1.0, Rust prebuilt binary), `hnswlib-node` (stale March 2024, native bindings), `sqlite-vec` + `better-sqlite3` (node-gyp required, breaks CI matrix), `fuse.js` (O(n) Bitap per query, no inverted index), raw `fetch` for Voyage (SDK ships proven CJS with retry semantics at same 3.5 MB).

**Voyage model:** `voyage-4-lite` — 1024 dims, $0.02/M tokens, 200M tokens/month free tier, 16M TPM free-tier rate limit. Full lifetime index (5,000 entries × 300 tokens avg = 1.5M tokens) is under 1% of free monthly allowance. Voyage-4 family shares an embedding space — upgrading to `voyage-4-large` later requires no re-indexing. Do NOT use `voyage-3-lite` or `voyage-3` (different embedding space; forced full re-embed to upgrade).

**Index location:** `~/.cache/second-brain/embeddings.jsonl` (XDG convention, outside vault, avoids iCloud Sync conflicts, avoids chokidar watcher triggers). One JSON line per entry: `{ hash, embedding, addedAt, category }`. Readline streaming keeps memory load proportional to access.

At 5,000 entries (realistic lifetime ceiling): 19.5 MB RAM, ~2–5 ms exhaustive cosine search. No HNSW needed below 10K entries; break-even for a real vector store is ~20K entries.

---

### Feature Table Stakes by Phase

**Phase 17 — UAT CI Infrastructure**
- Scheduled workflow + `workflow_dispatch` with `ANTHROPIC_API_KEY` secret
- Branch protection on `master`
- `nock` mock fixture for Voyage API established in test infrastructure before any Voyage code is written in Phase 19

**Phase 18 — Memory Retrieval Foundation**
- `readMemory()` and `listMemoryEntries()` — parse `memory.md` into `{ id, category, content, date, sourceRef, contentHash }` objects (foundation; blocks all other v1.4 features)
- Keyword search via `minisearch`: case-insensitive AND semantics, quoted phrase (`"..."`), negation (`-term`), ranked by term frequency, 100-char snippet extraction
- `/recall <query>` with `--category`, `--since`, `--top N` flags
- Memory Echo in `/today`: 3–5 entries matched via keyword search against today's calendar topics + VIP email subjects; **omit section entirely if zero results above 0.65 threshold** (empty section is worse than no section)

**Phase 19 — Semantic Memory Search**
- Embed-on-promotion: `indexNewEntries()` called inside `promote-memories.js` after `appendToMemoryFile()` — not at query time, not via chokidar, not on a cron
- `semanticSearch()`: embed query with `input_type: "query"`, cosine similarity vs stored vectors, threshold 0.72, temporal decay `adjusted_score = base_score * (1 + 0.2 * recency_weight)`
- `/recall --semantic` and `/recall --hybrid` flags; hybrid uses RRF: `1/(60 + rank_keyword) + 1/(60 + rank_semantic)`
- Graceful degradation: Voyage available → semantic; Voyage offline → keyword fallback with notice; lock sentinel held → keyword fallback

**Phase 20 — Value Extraction Instrumentation**
- `daily-stats.md` at `RIGHT/daily-stats.md`: one row per calendar day with idempotency check
- Columns: `date | proposals | promotions | total_entries | memory_kb | recall_count | avg_latency_ms | avg_confidence` (quality field in schema from day one, not retrofit)
- `/today` one-line summary: "Yesterday: +N proposals, +M promotions, +X KB memory"
- `daily-stats.js` called inline at end of `runToday()` after the daily note write — never as a separate pass

**Phase 21 — Closeout Hygiene**
- B-15 (Unicode exclusion-term tests), B-18 (JSDoc on new public APIs — waits for Phases 18–20 APIs to stabilize), B-20 (no-console policy decision executed), DOCS-FINAL-01 (final docs sweep)
- B-15 and B-20 can begin in parallel with Phase 20

### Anti-features (reject permanently)

- Real-time embedding on `/recall` — 2–5 s API latency per query; embed at promotion instead
- Local embedding model (sentence-transformers, llama.cpp) — Python dep, 400 MB+ model, breaks zero-setup deployment
- Interactive TUI for `/recall` — breaks non-TTY contexts; numbered list to stdout is sufficient
- LLM re-ranking of semantic results — RRF fusion is adequate; adds latency + cost
- Full corpus re-embed on every run — content-hash cache is mandatory day-one design

---

### Architecture Decisions

Four new modules, three modified. All integration points confirmed from direct source reads.

**New modules (flat in `src/` — no `src/memory/` subdirectory):**

| Module | Storage | Called By |
|--------|---------|-----------|
| `src/memory-reader.js` | `memory/memory.md` (read-only) | `recall-command.js`, `semantic-index.js`, `today-command.js` |
| `src/semantic-index.js` | `~/.cache/second-brain/embeddings.jsonl` (direct fs) | `recall-command.js`, `today-command.js`, `promote-memories.js` |
| `src/recall-command.js` | — (read-only command) | `.claude/commands/recall.md` |
| `src/daily-stats.js` | `RIGHT/daily-stats.md` (direct fs.appendFile) | `today-command.js` |

**Modified modules (additive only):**

| Module | Change |
|--------|--------|
| `src/promote-memories.js` | Add `indexNewEntries(promoted)` call after `appendToMemoryFile()` (Phase 19) |
| `src/today/briefing-renderer.js` | Add `_renderMemoryEchoSection()`, destructure `data.memoryEcho` (Phase 18) |
| `src/today-command.js` | Add `_fetchMemoryEcho()` private function; call `appendDailyStats()` at end of `runToday()` |

**Key integration patterns:**

- Memory Echo async work (`_fetchMemoryEcho`) runs in `today-command.js` orchestrator; result passed into synchronous `renderBriefing()` as `data.memoryEcho` — consistent with existing `_fanOut` / `_getPipelineState` pattern
- `semantic-index.js` and `daily-stats.js` both bypass `vault-gateway.js` — same precedent as `promote-memories.js` writing `memory.md` directly (`promote-memories.js:281`). Gateway is an ingress filter for user-provided content, not a universal write bus for internal pipeline
- Concurrency: `embeddings.jsonl.lock` sentinel; `/recall` falls back to keyword if lock is held
- Stale index detection: content-hash set comparison (hashes in `memory.md` vs hashes in index), not file mtime (misses archive rotation edge cases)
- Config: `memory.echo`, `memory.semantic`, `memory.recall`, `stats` keys added to `config/pipeline.json` with JSON Schema defaults; `memory.echo.enabled` defaults `true`

**Do not put embeddings inside the vault.** `~/Claude Cowork/memory/.index/` triggers iCloud Sync conflicts, chokidar watcher pollution, and vault search index noise. Use `~/.cache/second-brain/`.

---

### Critical Pitfalls by Phase

**Phase 17 (CI/UAT):**
- **P11 — UAT CI key leak:** mock all Voyage calls with `nock` in unit/integration tests. `VOYAGE_API_KEY` must not appear in `.github/workflows/*.yml` unless explicitly required by a separate scheduled UAT job. UAT guard (`process.env.CI && test.skip`) for live Voyage calls — same pattern as existing Anthropic UAT tests.

**Phase 18 (foundation):**
- **P10 — Metric gaming:** include quality fields (`avg_confidence`) in `daily-stats.md` schema from the initial Phase 20 commit. A stats table without quality dimension optimizes for volume over signal.

**Phase 19 (semantic — highest pitfall density):**
- **P3 — Cost runaway:** content-hash cache is mandatory. Verify test: run `/today` twice, confirm zero Voyage calls on second run. Per-run embedding budget cap.
- **P6 — Query privacy:** apply excluded-terms filter (all 15 terms) to `/recall` query text before `voyage.embed()`. Configure Voyage data-retention opt-out on account setup — prerequisite, not post-launch.
- **P5 — Voyage offline crash:** wrap all Voyage calls in `{success, data/error, failureMode}` pattern (same shape as `classify()` in `classifier.js`). Missing `VOYAGE_API_KEY` → `{ available: false }`, silent fallback.
- **P4 — Re-index thrash:** do NOT wire re-indexing to chokidar watcher. Trigger `indexNewEntries()` as an explicit step inside `/promote-memories` after all promotions are written. Lock sentinel prevents concurrent access.
- **P1 — Embedding drift:** store `schema_version` in `~/.cache/second-brain/index-metadata.json`. Check on startup; mismatch triggers full re-embed before serving results.
- **P7 — Index inside vault:** confirm `~/.cache/second-brain/embeddings.jsonl` is the storage path before writing the first entry.

**Phase 20 (instrumentation):**
- **P8 — Unbounded append:** read last row date before append. Update that row if today's date matches. One row per calendar day, strictly.
- **P9 — Timezone bugs:** single date utility function used by all instrumentation code. User's configured local timezone (`America/Los_Angeles`) for row keys. Unit test at 23:59 and 00:01 local time required.

---

## Implications for Roadmap

### Phase Structure (confirmed correct)

```
Phase 17 — UAT CI Infrastructure
  Independent of 18–21. Establishes nock mock before Voyage integration is written.

Phase 18 — Memory Retrieval Foundation
  memory-reader.js is the prerequisite for all v1.4 features.
  /recall (keyword) and Memory Echo (keyword) are functional outputs.

Phase 19 — Semantic Memory Search
  DEPENDS ON Phase 18: semantic-index.js calls readMemory() for hash-set comparison.
  /recall gains --semantic and --hybrid flags.

Phase 20 — Value Extraction Instrumentation
  DEPENDS ON Phase 18 (Memory Echo latency is meaningful).
  DEPENDS ON Phase 19 (semantic latency is the primary metric worth tracking).

Phase 21 — Closeout Hygiene
  DEPENDS ON 18–20 complete for B-18 JSDoc.
  B-15 and B-20 can start in parallel with Phase 20.
```

### Ordering Rationale

- **Foundation before features:** `readMemory()` is a synchronous prerequisite for every other v1.4 module
- **Keyword before semantic:** `/recall` keyword mode delivers immediate value and is the degradation target for semantic search
- **Semantic before instrumentation:** semantic latency is the metric that makes Phase 20 instrumentation meaningful; keyword latency (~0 ms) isn't worth tracking
- **CI mock before Voyage integration:** Phase 17's `nock` mock must exist before Phase 19 lands Voyage calls in the codebase
- **Hygiene last:** B-18 JSDoc requires stable public APIs from Phases 18–20

### Research Flags

**Needs `/gsd:research-phase`:** None. All phases use established patterns with architecture confirmed from direct source reads.

**Open questions to resolve in Phase 18 planning (not blocking):**
- Memory Echo query construction: `data.synthesis` text (already in `renderBriefing` data contract) vs frog text + top slippage project names. Recommendation: start with `data.synthesis`; switch if keyword recall quality is poor.
- Memory Echo threshold: 0.65 initial value as a config option; tune empirically after Phase 18 ships.

**One discrepancy to resolve before Phase 19:** ARCHITECTURE.md config example shows `voyage-3-lite`; STACK.md recommends `voyage-4-lite`. Correct value is **`voyage-4-lite`** — different embedding space from voyage-3 family.

**`daily-stats.md` directory bootstrap:** verify `RIGHT/` exists in `bootstrapVault()` at Phase 20 kickoff; if not, `daily-stats.js` must call `fs.promises.mkdir({ recursive: true })` (pattern matches `promote-memories.js:186`).

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Three packages registry-verified with install inspection. Voyage pricing and rate limits confirmed from live docs. Vector-store arithmetic verified. |
| Features | HIGH | Categories derived from direct reads of `memory-extractor.js`, `memory-proposals.js`, `briefing-renderer.js`, and live `memory.md`. |
| Architecture | HIGH | All integration points derived from direct reads of six source files with line numbers cited. No speculation. |
| Pitfalls | HIGH | Embedding drift, cost runaway, query privacy, and lock contention verified against Voyage docs, ChromaDB FAQ, Pinecone/Faiss guides, embedding inversion research. |

**Overall: HIGH**

---

## Sources

**Primary:**
- `npm view voyageai` + install inspection; `npm view minisearch`; `npm view nock` — versions and module formats verified
- Voyage AI docs — voyage-4-lite at $0.02/M tokens, 200M tokens/month free tier, 1024 dims, voyage-4 family shares embedding space
- Direct reads: `src/today-command.js`, `src/today/briefing-renderer.js`, `src/promote-memories.js`, `src/vault-gateway.js`, `config/pipeline.json`, `.planning/PROJECT.md`, `src/memory-extractor.js`, `src/memory-proposals.js`

**Secondary:**
- QMD project (GitHub) — BM25 + vector hybrid with RRF fusion as Node.js-native pattern
- Hybrid Search Guide (supermemory.ai, 2026) — +1.4× precision improvement for hybrid confirmed
- Tonic.ai / IronCore Labs research — 40% PII recovery from sentence-level embeddings
- ChromaDB FAQ — schema version incompatibility patterns
- Pinecone / Faiss guides — HNSW memory calculation formula

---

## Quick Reference for Announcing Research-Complete

**Stack additions:**
- `voyageai` 0.2.1 (CJS, 3.5 MB)
- `minisearch` 7.2.0 (CJS, 876 KB, zero deps)
- `nock` 14.0.13 (dev, HTTP mock)
- Vector store: in-memory `Float32Array` cosine — zero new prod dep

**Feature table stakes:**
- Phase 17: UAT CI workflow + branch protection + nock mock infrastructure
- Phase 18: `readMemory()`, `/recall` keyword mode, Memory Echo in `/today`
- Phase 19: Voyage AI semantic search with embed-on-promotion + RRF hybrid + graceful degradation
- Phase 20: `daily-stats.md` append-only with idempotency + quality fields
- Phase 21: Unicode tests, JSDoc, no-console policy, docs sweep

**Watch Out For:**
- Cost runaway → content-hash cache is mandatory
- Query privacy → filter `/recall` text with exclusion terms before embedding
- Re-index thrash → explicit trigger in `/promote-memories`, never chokidar
- Timezone bugs → single date utility, unit-tested at 23:59 and 00:01
- CI Voyage key leak → `nock` mock in all unit/integration tests
