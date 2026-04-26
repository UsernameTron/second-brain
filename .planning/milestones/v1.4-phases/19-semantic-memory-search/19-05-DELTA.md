# Phase 19 Docs Delta

All claims below were verified against live artifacts before any doc edit.

## New commands (add to CLAUDE.md + README.md tables)

| Command | Description | Source |
|---|---|---|
| `/recall --semantic <query>` | Semantic search via Voyage AI embeddings with cosine similarity + recency decay | verified: `grep -n "'--semantic'" src/recall-command.js` → line 31 |
| `/recall --hybrid <query>` | RRF fusion of keyword + semantic results; falls back to keyword if Voyage unavailable | verified: `grep -n "'--hybrid'" src/recall-command.js` → line 33 |

## New environment variables (DEVOPS-HANDOFF.md)

| Var | Required? | Default | Purpose | Source |
|---|---|---|---|---|
| `VOYAGE_API_KEY` | Optional (needed for --semantic/--hybrid) | unset | Voyage AI API key for embedding generation | verified: `grep -n "VOYAGE_API_KEY" src/semantic-index.js` → lines 99, 102, 105, 145 |

## New config keys (DEVOPS-HANDOFF.md)

All from `config/pipeline.json` `memory.semantic` block (verified):

| Key | Default | Range/Constraint | Purpose |
|---|---|---|---|
| `memory.semantic.model` | `"voyage-4-lite"` | enum (AJV-validated) | Voyage AI embedding model |
| `memory.semantic.threshold` | `0.72` | 0–1 float | Cosine similarity cutoff for semantic results |
| `memory.semantic.recencyDecay` | `0.2` | 0–1 float | Temporal boost factor applied at query time |
| `memory.semantic.rrfK` | `60` | ≥1 integer | RRF k constant for hybrid fusion |
| `memory.semantic.candidatesPerSource` | `20` | 1–200 integer | Top-N candidates per source for RRF fusion |
| `memory.semantic.embedBatchSize` | `128` | 1–128 integer | Voyage API batch size maximum |
| `memory.semantic.timeoutMs` | `3000` | ≥100 integer | Voyage API request timeout in ms |
| `memory.semantic.degradedModeMinutes` | `15` | ≥1 integer | Degraded-mode window length after 3 consecutive failures |
| `memory.semantic.embeddingDim` | `1024` | enum (1024) | Vector dimension (must match model output) |

Source: `config/pipeline.json` lines 60–70 verified by direct read.

## New artifacts (DEVOPS-HANDOFF.md)

Cache directory: `~/.cache/second-brain/` (or `$CACHE_DIR_OVERRIDE` for test isolation)

| File | Purpose | Permissions | Retention |
|---|---|---|---|
| `embeddings.jsonl` | One line per entry: `{hash, embedding, addedAt, category}` | chmod 0600 | Permanent; reclaimed only on schema_version change |
| `index-metadata.json` | `{schema_version, updatedAt}` | chmod 0600 | Permanent |
| `voyage-health.json` | `{consecutive_failures, last_failure, last_failure_code, degraded_until}` | chmod 0600 | Ephemeral (reset on successful Voyage call) |

Cache dir itself: chmod 0700. Created automatically on first `/recall --semantic`.

verified: `grep -n "getSemanticCacheDir\|voyage-health.json\|embeddings.jsonl\|index-metadata.json" src/semantic-index.js src/utils/voyage-health.js` — all paths confirmed in source.

## New dependency

- `voyageai@0.2.1` (production, exact pin, MIT license)
- verified: `grep '"voyageai"' package.json` → `"voyageai": "0.2.1"`

## Test count (post-Phase-19)

- **Total test files:** 52 (verified: `find test -name '*.test.js' | wc -l`)
- **Total tests:** 982 (944 passing, 38 skipped)
- **Skipped breakdown:** 38 total — 24 UAT CI-guarded (`CI=true` skip guard) + 13 pre-existing API-key guards + 1 pre-existing uat-classification skip
- **Source:** `CI=true npx jest --forceExit 2>&1 | tail -5` → "Tests: 38 skipped, 944 passed, 982 total"

## Coverage (post-Phase-19)

From `CI=true npx jest --forceExit --coverage 2>&1 | grep "All files"`:

| Metric | Value |
|---|---|
| Statements | 94.62% |
| Branch | 81.28% |
| Functions | 96.94% |
| Lines | 95.53% |

## Degradation behavior (DEVOPS-HANDOFF.md)

- Threshold: 3 consecutive Voyage API failures → degraded mode activates
- Window: 15 minutes (configurable via `memory.semantic.degradedModeMinutes`)
- User-facing banner: `(semantic unavailable — using keyword only)` or `(hybrid unavailable — using keyword only)`
- Recovery: one successful Voyage call resets `consecutive_failures` to 0
- State file: `~/.cache/second-brain/voyage-health.json`

verified: `grep -n "DEGRADED_FAILURE_THRESHOLD\|degradedBanner\|consecutive_failures" src/utils/voyage-health.js src/recall-command.js` — all confirmed.

## REQ-ID coverage plan

| REQ-ID | Target doc section |
|---|---|
| MEM-EMBED-01 | DEVOPS-HANDOFF.md — Voyage AI embeddings / environment variables |
| MEM-SEMANTIC-01 | DEVOPS-HANDOFF.md — Semantic search configuration |
| MEM-INDEX-REFRESH-01 | DEVOPS-HANDOFF.md — Cache / Disk section (schema_version triggers re-embed) |
| MEM-DEGRADE-01 | DEVOPS-HANDOFF.md — Degradation behavior section |

## Deferred tech debt (for DEVOPS-HANDOFF.md)

- Phase 21 will handle HYG-JSDOC-01 (JSDoc on public API including Phase 19 modules)
- Phase 21 will handle HYG-CONSOLE-01 (no-console warnings)
- FUT-HNSW-01: HNSW index deferred until vault exceeds ~20K entries
- FUT-RERANK-01: Cross-encoder reranking deferred; RRF adequate for v1.4
