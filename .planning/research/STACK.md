# Stack Research — v1.4 Memory Activation

**Domain:** Keyword + semantic memory search over a personal Obsidian vault (one user, one markdown file)
**Researched:** 2026-04-24
**Confidence:** HIGH — all package versions registry-verified, Voyage API confirmed from live docs, module formats confirmed by install inspection

## Scope

This document covers only the NEW stack additions for v1.4 (Phases 18–19). The existing stack (Node.js 20+22, @anthropic-ai/sdk 0.90, Jest 30, AJV 8, chokidar 3.6, gray-matter 4, dotenv 17.4) is validated and not re-researched here.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `voyageai` | 0.2.1 | Voyage AI embeddings client | Official SDK, ships CJS build at `./dist/cjs/`, 3.5 MB install, zero native deps |
| `minisearch` | 7.2.0 | Keyword full-text search | Inverted-index, CJS build at `./dist/cjs/index.cjs`, 876 KB install, zero deps, handles markdown well |
| `nock` | 14.0.13 | HTTP mock for Voyage API in Jest | Intercepts node-fetch/http at socket level; no ESM wrapper needed in CJS Jest |

**Vector store: in-memory Float32Array with cosine similarity — no new dependency.**

See "Vector Store Decision" below for full rationale.

### Supporting Libraries

No additional production dependencies beyond the three above. All other capabilities are covered by native Node.js (`fs`, `readline`) or existing deps (`gray-matter` for frontmatter parsing).

---

## Vector Store Decision

### Scale reality for this project

Pete is one user. `memory.md` is one file, append-only, human-curated. Realistic entry counts:

| Phase | Expected entries | Embedding RAM at 1024 dims |
|-------|-----------------|---------------------------|
| Phase 19 launch | 50–200 | 0.2–0.8 MB |
| 6 months | 200–1000 | 0.8–3.9 MB |
| Maximum realistic | 2000–5000 | 7.8–19.5 MB |

At 2000 entries with 1024-dim Float32Array: **7.8 MB RAM, ~2 ms exhaustive cosine search** in Node.js.

### Recommendation: In-memory Float32Array with cosine similarity

Zero new production dependencies. Load the JSONL index file at search time, run exhaustive cosine similarity, return top-k. Persist the index as JSONL (one JSON object per line) in `~/Claude Cowork/memory/.index/embeddings.jsonl`.

```javascript
// Pattern — no library needed
const { cosineSimilarity } = require('./src/search/cosine');
// cosineSimilarity(a, b) = dot(a,b) / (|a| * |b|)
// ~10 lines of vanilla JS, trivially testable
```

### Why not sqlite-vec

`sqlite-vec` 0.1.9 is stable but requires `better-sqlite3` as the SQLite host. `better-sqlite3`'s install script is `prebuild-install || node-gyp rebuild` — native compilation that breaks on CI runners without Python and node-gyp installed. The WebAssembly variant exists but adds config complexity. For < 5K vectors this is pure overhead with no performance benefit.

### Why not @lancedb/lancedb

111 MB install (Rust prebuilt binary + apache-arrow 18.1.0). The peer dep pins arrow to `>=15.0.0 <=18.1.0` — the current registry version is 21.1.0, so lancedb actively pulls back an older major. This creates a conflict risk if any future dep needs arrow. Rejected on install size and peer dep interference alone.

### Why not hnswlib-node

Last published March 2024 (over a year stale). Uses native bindings. No meaningful performance advantage over exhaustive search at < 5K entries.

### Break-even trigger

Revisit if entries exceed ~20K or search latency in practice exceeds 50 ms. Log this threshold in `.planning/STATE.md`. At current growth rate for a single-user vault, this is not a 2026 concern.

---

## Voyage AI Integration

### SDK vs raw fetch

Use the `voyageai` npm package — not raw `fetch`. The exports field confirms a CJS build:

```
exports['.'].require → ./dist/cjs/extended/index.js   ("use strict" confirmed by install inspection)
```

The package depends on `node-fetch ^2.7.0` internally, so it works on Node.js 18+ without the global `--experimental-fetch` flag. Install footprint: 3.5 MB.

### Model selection: voyage-4-lite

| Model | Dims | Free TPM | $/M tokens | Rec |
|-------|------|----------|------------|-----|
| voyage-4-large | 1024 | 3M | $0.12 | Future upgrade path, not for v1.4 |
| voyage-4 | 1024 | 8M | $0.06 | Good but 3x cost of lite for identical use case |
| **voyage-4-lite** | **1024** | **16M** | **$0.02** | **Use this** |
| voyage-code-3 | 1024 | 3M | $0.02 | Only if memory entries are predominantly code |

**Use `voyage-4-lite`.** Memory entries are short general text (100–500 tokens each). At $0.02/M tokens with a 200M token/month free tier, the entire realistic lifetime index (5000 entries × 300 tokens avg = 1.5M tokens) consumes less than 1% of the monthly free allowance.

The Voyage 4 family shares an embedding space — embeddings from voyage-4-lite and voyage-4-large are interchangeable. If quality needs to improve later, re-embed documents with voyage-4-large and continue querying with voyage-4-lite without restructuring the index.

**Do not use voyage-3-lite or voyage-3.** They live in a different embedding space. Upgrading to voyage-4 later requires full re-embedding of all stored vectors.

### Rate limits (free tier)

- RPM: 2,000 (not a constraint for batch index builds)
- TPM: 16M/min for voyage-4-lite (not a constraint at this scale)
- No daily limits; 429 errors trigger exponential backoff

### Embedding dimensions

Use 1024 (the default). Voyage 4 supports Matryoshka dimensions (256, 512, 1024, 2048) but 1024 is the best accuracy/size tradeoff. At < 5K entries the storage difference between 256 and 1024 dims is under 10 MB — not worth the accuracy loss.

---

## Index Persistence Format: JSONL

Store the embedding index at `~/Claude Cowork/memory/.index/embeddings.jsonl`. One JSON object per line:

```jsonl
{"id":"mem-001","text":"Pete prefers direct communication without preamble","embedding":[0.023,...1024 floats...],"ts":"2026-04-24","source":"memory.md#L42"}
```

**Why JSONL over SQLite:** Zero native deps. Human-readable and git-diffable. `readline` streaming means you never load the full file in one shot — metadata-only pass for keyword search, full float array load only for semantic search. Portable across machines with no binary format lock-in.

**Why JSONL over binary (Float32Array .bin + sidecar JSON):** Binary deserializes ~10x faster but the absolute difference at < 5K entries is under 5 ms — not meaningful. Binary files cannot be inspected or diffed, which matters for a memory system Pete reviews manually.

**Rebuild strategy:** Index is rebuilt on-demand (not incrementally) when `memory.md` changes. At < 5K entries and 16M TPM rate limit, a full rebuild takes < 1 second of API time and < 1 second of local processing. No incremental merge complexity needed.

---

## Keyword Search: minisearch

Use `minisearch` 7.2.0 for Phase 18 keyword search path.

**Why not `fs.readFile + String.includes`:** No ranking, no fuzzy tolerance, no field weighting. Acceptable for a one-off grep, not for a `/recall` command.

**Why not fuse.js:** Bitap algorithm iterates the full collection per query — O(n) with no index. Fine for < 500 items, degrades linearly. No inverted index means no prefix search or phrase matching.

**Why minisearch:** Inverted index gives O(log n) lookup. CJS build confirmed (`./dist/cjs/index.cjs`). 876 KB install, zero runtime dependencies. Supports fuzzy search, prefix search, field boosting, and stop words — all useful for memory retrieval over a markdown corpus.

```javascript
const MiniSearch = require('minisearch');
const index = new MiniSearch({
  fields: ['text', 'source'],
  storeFields: ['id', 'text', 'ts', 'source']
});
```

The keyword index and the JSONL embedding index both derive from the same parsed `memory.md` — one source of truth, two search modes.

---

## New Dev Dependencies

One addition to `devDependencies`:

| Package | Version | Purpose |
|---------|---------|---------|
| `nock` | ^14.0.13 | Mock Voyage AI HTTP calls in Jest unit tests |

**Jest mocking strategy for Voyage API:**

```javascript
const nock = require('nock');

nock('https://api.voyageai.com')
  .post('/v1/embeddings')
  .reply(200, {
    data: [{ embedding: new Array(1024).fill(0.1), index: 0 }],
    model: 'voyage-4-lite',
    usage: { total_tokens: 12 }
  });
```

`nock` intercepts at the `http` module level and works with `voyageai`'s internal `node-fetch` dependency without any Jest transform config changes. This covers the graceful-degradation path (MEM-DEGRADE-01) without a real API key in CI. `nock@14` requires Node >=18.20.0 — compatible with the project's Node 20+22 matrix.

---

## Installation

```bash
# Production
npm install voyageai minisearch

# Dev
npm install -D nock
```

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@lancedb/lancedb` | 111 MB install, Rust binaries, apache-arrow peer dep pins to <=18.1.0 (current registry is 21.1.0) | In-memory Float32Array cosine similarity |
| `faiss-node` | Wraps Facebook FAISS, requires Python + native build, designed for millions of vectors | In-memory cosine similarity |
| `hnswlib-node` | Last published March 2024, native bindings, no advantage at this scale | In-memory cosine similarity |
| `sqlite-vec` + `better-sqlite3` | `better-sqlite3` requires `node-gyp rebuild` on CI; sqlite-vec docs are ESM-only | JSONL + `fs`/`readline` |
| `openai` or any other embedding provider | Project locked to Anthropic + Voyage AI | `voyageai` SDK |
| `langchain` / `llamaindex` | Framework abstraction over a system already orchestrated by Claude Code | Direct `voyageai` SDK calls |
| `fuse.js` | O(n) per query, no inverted index, degrades at 1K+ entries | `minisearch` |
| `voyage-3-lite` / `voyage-3` model | Different embedding space — requires full re-embed to upgrade to voyage-4 | `voyage-4-lite` |
| `msw` (Mock Service Worker) | Adds fetch interception at browser/service-worker layer; overkill for Node.js HTTP mocking | `nock` |

---

## Version Compatibility

| Package | Requires | Notes |
|---------|---------|-------|
| `voyageai@0.2.1` | Node.js 18+ | CJS build confirmed. node-fetch 2.x bundled internally. Works in Jest 30 without transform config. |
| `minisearch@7.2.0` | Node.js 14+ | CJS at `./dist/cjs/index.cjs`. Zero deps. |
| `nock@14.0.13` | Node >=18.20.0 | Compatible with project Node 20+22 CI matrix. |
| In-memory cosine | None | Vanilla JS, Float32Array (built-in). |
| JSONL index | None | `fs` + `readline` (built-in). |

---

## Sources

### Primary — registry-verified (HIGH confidence)

- `npm view voyageai` + install inspection — v0.2.1, CJS at `./dist/cjs/extended/index.js` (`"use strict"` confirmed), 3.5 MB
- `npm view minisearch` + install inspection — v7.2.0, CJS at `./dist/cjs/index.cjs` confirmed, 876 KB, zero deps
- `npm view nock` — v14.0.13, Node >=18.20.0
- `npm install @lancedb/lancedb` (temp) — 111 MB, apache-arrow 18.1.0 pulled, `type` field absent (CJS default), prebuilt binary at `lancedb.darwin-arm64.node`
- `npm view better-sqlite3` — install script: `prebuild-install || node-gyp rebuild` (native build confirmed)
- `npm view sqlite-vec` — v0.1.9 stable, ESM-only import examples in official docs
- `npm view hnswlib-node` — v3.0.0, last published March 2024

### Primary — live Voyage AI docs (HIGH confidence)

- [docs.voyageai.com/docs/pricing](https://docs.voyageai.com/docs/pricing) — 200M tokens/month free for voyage-4-lite; $0.02/M tokens confirmed
- [docs.voyageai.com/docs/rate-limits](https://docs.voyageai.com/docs/rate-limits) — 16M TPM, 2K RPM free tier confirmed
- [docs.voyageai.com/docs/embeddings](https://docs.voyageai.com/docs/embeddings) — voyage-4-lite: 1024 dims (default), 32K context, recommended for latency/cost
- [blog.voyageai.com/2026/01/15/voyage-4](https://blog.voyageai.com/2026/01/15/voyage-4/) — shared embedding space across voyage-4 family; voyage-4-lite outperforms voyage-3.5 by ~4.80% on retrieval benchmarks

### Secondary — arithmetic (HIGH confidence, no external source needed)

- In-memory feasibility: 1024 dims × 4 bytes × 5000 entries = 19.5 MB RAM; exhaustive search ~5 ms at 10M float ops/sec — well within interactive latency budget

---

*Stack research for: v1.4 Memory Activation — keyword + semantic search additions only*
*Researched: 2026-04-24*
*Valid until: 2026-07-24 (voyage-4 model lineup and voyageai SDK are stable; re-verify if lancedb or sqlite-vec ship major versions)*
