# Architecture Research — v1.4 Memory Search Integration

**Domain:** Memory retrieval + instrumentation layer on existing Second Brain pipeline
**Researched:** 2026-04-24
**Confidence:** HIGH — based on direct source reads of all six integration-point files

---

## Summary

v1.4 adds a read path to a write-only memory layer. The write path (`/wrap` → proposals → `/promote-memories` → `memory.md`) is complete and stable across v1.0–v1.3. The new work is: reading that file for retrieval (`memory-reader.js`), building a semantic index on top of it (`semantic-index.js`), surfacing results in `/today` (Memory Echo section) and `/recall` (new command), and capturing instrumentation (`daily-stats.js`).

Every integration question below has a concrete answer derived from source inspection. No speculative recommendations.

---

## 1. Module Placement

### Decision: Flat in `src/` — no nesting

The existing pattern is flat single-responsibility modules directly in `src/`:

```
src/
  memory-extractor.js    # write: extract candidates from session
  memory-proposals.js    # write: write to proposals file
  promote-memories.js    # write: promote proposals → memory.md
  vault-gateway.js       # enforcement: LEFT/RIGHT write boundary
  today-command.js       # orchestrator: /today
  classifier.js          # LLM routing
```

No subfolder grouping exists. The `src/today/` subdirectory is the single exception, justified because four modules were extracted from one 727-line file during Phase 15 — they are tight siblings of a single command.

**Ruling:** Place `memory-reader.js`, `semantic-index.js`, and `daily-stats.js` flat in `src/`. Do NOT create `src/memory/`. Reasons:

1. No existing precedent for domain subfolders (only command subfolders).
2. A `src/memory/` subfolder would require updating all existing import paths that reference `./promote-memories`, `./memory-extractor`, etc. by relative path.
3. These three modules are consumers of different parts of the pipeline — grouping them implies coupling that does not exist.

```
src/
  memory-reader.js        # NEW: readMemory(), listMemoryEntries(), searchMemoryKeyword()
  semantic-index.js       # NEW: Voyage embeddings, local vector index, semanticSearch()
  daily-stats.js          # NEW: daily-stats.md append-only writer
  recall-command.js       # NEW: /recall entry point (see §2 below)
  promote-memories.js     # MODIFIED: embed-on-promotion hook (§3)
  today/briefing-renderer.js  # MODIFIED: Memory Echo section (§2)
  today-command.js        # MODIFIED: daily-stats call at runToday() exit (§2)
```

---

## 2. Invocation Points

### 2a. Memory Echo in `/today`

**Where:** `src/today/briefing-renderer.js`, function `renderBriefing()` (line 246).

**Current pattern (lines 260–292):** The function assembles the briefing string by joining sections in an array. Sections are rendered by private `_render*` functions. The renderer is intentionally synchronous and side-effect-free — all async work is done upstream in `today-command.js` before `renderBriefing()` is called.

**Integration approach:**

Memory Echo follows the same pattern as existing sections:

1. In `today-command.js` (`runToday()`, lines 126–226): call `semanticSearch()` or `searchMemoryKeyword()` after the existing data-gathering block. This is async and belongs in the orchestrator, not the renderer. Pass the result into `renderBriefing()` as `data.memoryEcho`.

2. In `briefing-renderer.js`: add `_renderMemoryEchoSection(memoryEcho)` following the `_render*` pattern. Add `data.memoryEcho` to the destructure at line 247. Append the section to the join array at line 260 after Pipeline (last section) — it is a reflection, not a time-sensitive source.

3. The `data` object passed to `renderBriefing` gains one field: `memoryEcho: { entries: Array, query: string, source: 'semantic'|'keyword'|'disabled' } | null`.

**Degradation:** If `memory.echo.enabled` is false OR memory file does not exist OR search throws, pass `memoryEcho: null`. The renderer emits nothing for that section. Same pattern as `_No meetings scheduled today._` empty-state fallback.

**What changes in `today-command.js` (in `runToday`, after line ~189):**

```js
// After synthesis, before renderBriefing call:
const memoryEcho = config?.memory?.echo?.enabled
  ? await _fetchMemoryEcho(config, synthesis)
  : null;

const briefing = renderBriefing({
  // ...existing fields...
  memoryEcho,
});
```

`_fetchMemoryEcho` is a new private function in `today-command.js` following the `_fanOut` / `_getPipelineState` pattern — wraps the search call in try/catch, never throws, returns null on failure.

### 2b. `/recall` Entry Point

**Decision: `src/recall-command.js` + `.claude/commands/recall.md`**

The existing pattern for commands:
- `.claude/commands/today.md` — Claude Code slash command definition, calls the Node module
- `src/today-command.js` — the actual implementation

`/recall` follows this exact pattern:

- `.claude/commands/recall.md` — slash command definition with `$ARGUMENTS` plumbing, calls `node scripts/recall.js "$ARGUMENTS"` or equivalent
- `src/recall-command.js` — implementation: parses query, calls `semanticSearch()` or `searchMemoryKeyword()`, formats results, returns to stdout

Business logic belongs in `src/recall-command.js`, mirroring `src/today-command.js`. Scripts in `scripts/` hold thin entry points only.

### 2c. `daily-stats.js` Invocation

**Where:** End of `runToday()` in `today-command.js`, after the `fs.promises.writeFile(outputPath, briefing)` call (line 209) but before the `return` at line 216.

**Pattern:**

```js
// After writing daily note, before return:
if (config?.stats?.enabled !== false) {
  try {
    const echoLatencyMs = /* captured via Date.now() around _fetchMemoryEcho */;
    await appendDailyStats({
      date,
      memoryEchoUsed: !!memoryEcho,
      memoryEchoLatencyMs: echoLatencyMs,
      sourceHealth,
    });
  } catch (err) {
    // Non-fatal: stats failure never breaks /today
    process.stderr.write(`[today] stats write failed: ${err.message}\n`);
  }
}
```

`daily-stats.js` exports `appendDailyStats(row)` — an append-only writer to `~/Claude Cowork/RIGHT/daily-stats.md`. It never throws (matches existing non-blocking pattern for non-critical writes).

**Not a separate post-/today pass.** A separate step creates a gap window where the briefing exists but stats do not, and adds an extra invocation. Inline at the end of `runToday()` is the right location.

---

## 3. Semantic Index Lifecycle

### 3a. When are embeddings computed?

**Decision: Embed-on-promotion.**

Rationale:

- `/promote-memories` is the single controlled point where new entries enter `memory.md` (line 350, `appendToMemoryFile(promoted)`). This is the cheapest place to compute embeddings — the entry content is already in memory, the operation is bounded (batch cap max 10), and embedding is synchronous to the promotion event.
- Lazy-on-query is worse: the first `/recall` call after N promotions has unpredictable latency. Index rebuild at query time under concurrent load creates a race.
- Scheduled batch is worse: requires a separate cron or command, creates a window where promoted entries are unsearchable, adds operational complexity.

**Implementation:** In `promote-memories.js`, after `appendToMemoryFile(promoted)` at line 350, add:

```js
// Embed newly promoted entries (non-blocking — failures logged, not thrown)
if (promoted.length > 0 && config.memory?.semantic?.enabled) {
  try {
    await indexNewEntries(promoted);  // from semantic-index.js
  } catch (err) {
    process.stderr.write(`[promote] embedding failed: ${err.message}\n`);
  }
}
```

`indexNewEntries(entries)` appends new embedding vectors to the index file without rebuilding the full index. The promotion batch cap (max 10) keeps the Voyage API call bounded.

### 3b. Where is the index stored?

**Decision: Outside the vault — `~/.cache/second-brain/embeddings.jsonl`**

Rationale:

- The index is a cache, not content. It contains no human voice, no vault data — just float vectors keyed by content hash. It does NOT belong in `~/Claude Cowork/`.
- Putting it in the vault would: (a) trigger chokidar watchers in `vault-gateway.js`, (b) require vault-gateway routing, (c) pollute Obsidian's file list, (d) violate the principle that agent-generated machine data does not enter the vault.
- `~/.cache/second-brain/` follows XDG convention. The project already uses `process.env.HOME` for path construction — see `vault-gateway.js` line 44 and `today-command.js` lines 42–44.
- Absolute path: `path.join(process.env.HOME, '.cache', 'second-brain', 'embeddings.jsonl')`

`daily-stats.md` is different — it is human-readable vault content and belongs on the RIGHT side (see §4).

**Index file format — JSONL, one record per promoted entry:**

```json
{"hash":"<content_hash>","embedding":[0.123,...],"addedAt":"2026-04-24T...","category":"insight"}
```

`content_hash` from the memory entry's `content_hash::` field links vectors back to entries without duplicating text.

### 3c. Stale index detection

**Decision: Content-hash set comparison on load.**

On each `semanticSearch()` or `indexNewEntries()` call, `semantic-index.js` loads the index and extracts the set of hashes it contains. It then reads the set of hashes from `memory.md` (via `memory-reader.js`). Entries in `memory.md` with no corresponding index entry are missing vectors — they get queued for embedding on the next `indexNewEntries()` call or on an explicit `rebuildIndex()` call.

Using file mtime on `memory.md` alone is insufficient — the file is append-only with no rewrites except during archive rotation. Hash-set comparison is exact and handles archive rotation correctly: when entries move to archive, they vanish from the live hash set and fall out of the search index automatically.

**Rebuild command:** `/recall --rebuild` or a standalone script — explicit operator trigger only. No automatic full rebuild on stale detection (Voyage API rate limits make silent rebuilds risky).

### 3d. Concurrency: `/recall` while `/promote-memories` is rebuilding

**Decision: File-level lock sentinel + read-around fallback.**

`semantic-index.js` writes `embeddings.jsonl` only during `indexNewEntries()` and `rebuildIndex()`. `/recall` reads it.

Protocol:

1. Before write, `semantic-index.js` creates `~/.cache/second-brain/embeddings.jsonl.lock`.
2. `semanticSearch()` checks for the lock file on entry. If present, falls back to keyword search from `memory-reader.js` (same degradation path used when the Voyage API is unavailable).
3. After write, lock file is deleted in a `finally` block.

Node.js is single-threaded per process, and `/recall` and `/promote-memories` run in separate Claude Code invocations, so concurrent write is an edge case. The lock sentinel handles it without a mutex library dependency.

---

## 4. Integration with vault-gateway

### 4a. Semantic index — bypasses vault-gateway

The semantic index (`~/.cache/second-brain/embeddings.jsonl`) is outside the vault. `semantic-index.js` writes it directly via `fs.promises.writeFile` — no vault-gateway routing. Reasons:

- `vaultWrite()` enforces the RIGHT-side path allowlist (Guard 1). Cache files outside `~/Claude Cowork/` are not in the vault manifest and would fail Guard 1.
- Cache files are not vault content. They contain no human voice, no excluded terms, no prose that needs style linting. Routing them through all three guards would be incorrect.
- Precedent: `promote-memories.js` already writes `memory.md` directly via `fs.writeFileSync` (line 281) without routing through `vaultWrite()`. The vault-gateway is the ingress gate for user-provided content — not a universal write bus for internal pipeline operations.

### 4b. `daily-stats.md` — bypasses vault-gateway

`daily-stats.md` is machine-generated metrics content (append-only table rows). It lives at `~/Claude Cowork/RIGHT/daily-stats.md`.

Despite being on the RIGHT side, it should NOT go through `vaultWrite()`. Guard 2 (content filter) would produce false positives on numeric metric data; Guard 3 (style lint) would flag metric labels as banned words. The precedent is `promote-memories.js`, which writes `memory.md` directly.

**Pattern for `daily-stats.js`:**

```js
const STATS_FILE = path.join(
  process.env.VAULT_ROOT || path.join(process.env.HOME, 'Claude Cowork'),
  'RIGHT', 'daily-stats.md'
);
```

This follows the exact same pattern as `promote-memories.js` line 18: `const MEMORY_FILE = () => path.join(VAULT_ROOT(), 'memory', 'memory.md')`.

**Why `RIGHT/daily-stats.md` and not `memory/daily-stats.md`?** Stats are operational metrics, not memory entries. A separate location keeps `memory/` clean for the promotion pipeline and avoids confusing Obsidian searches.

---

## 5. Config Additions

New sections in `config/pipeline.json` following the existing flat-object-per-feature pattern. Each existing top-level key (`classifier`, `extraction`, `promotion`, etc.) is a single flat object. New keys follow the same convention:

```json
{
  "memory": {
    "echo": {
      "enabled": true,
      "maxEntries": 3,
      "querySource": "synthesis",
      "fallbackToKeyword": true
    },
    "semantic": {
      "enabled": true,
      "provider": "voyage",
      "model": "voyage-3-lite",
      "indexPath": "~/.cache/second-brain/embeddings.jsonl",
      "scoreThreshold": 0.75,
      "gracefulDegradation": true
    },
    "recall": {
      "maxResults": 5
    }
  },
  "stats": {
    "enabled": true,
    "statsFile": "RIGHT/daily-stats.md"
  }
}
```

**Schema additions** in `config/schema/pipeline.schema.json`: add `memory` and `stats` as optional properties with `additionalProperties: false` and type-validated sub-keys. All sub-keys carry JSON Schema defaults so existing installations without these config keys continue to work without modification.

**Feature flag defaults:**

| Flag | Default | Rationale |
|------|---------|-----------|
| `memory.echo.enabled` | `true` | Memory Echo is a core v1.4 deliverable — off-by-default defeats the milestone goal |
| `memory.semantic.enabled` | `true` | Semantic search is the milestone feature |
| `stats.enabled` | `true` | Instrumentation is always-on |
| `memory.semantic.gracefulDegradation` | `true` | If Voyage API key is absent, fall back to keyword silently |

If `VOYAGE_API_KEY` is absent from environment, `semantic-index.js` returns `{ available: false }` and all callers fall back to keyword search. No config flag needed for this — it is a runtime condition, not a configuration choice.

---

## 6. Build Order for Phases 17–21

### Dependency graph

```
Phase 17: UAT CI Infrastructure
  No code dependencies on 18–21. Fully independent.

Phase 18: Memory Retrieval Foundation
  Deliverables: memory-reader.js, /recall (keyword), Memory Echo in /today (keyword)
  No dependency on Phase 19 (semantic is an enhancement on top of keyword)

Phase 19: Semantic Memory Search
  DEPENDS ON Phase 18: memory-reader.js must exist
    (semantic-index.js calls readMemory to get hash set for stale detection)
  DEPENDS ON Phase 18: /recall must exist
    (semantic search replaces keyword in /recall)
  Deliverables: semantic-index.js, embed-on-promotion hook in promote-memories.js

Phase 20: Value Extraction Instrumentation
  DEPENDS ON Phase 18: Memory Echo must exist
    (daily-stats tracks "echo used" boolean and echo latency)
  DEPENDS ON Phase 19: Semantic latency metric is only meaningful post-Phase 19
    (keyword latency is ~0ms, not worth tracking)
  Deliverables: daily-stats.js, daily-stats.md, stats wiring in today-command.js

Phase 21: Closeout Hygiene
  DEPENDS ON Phase 18–20 being complete for JSDoc coverage of new modules (B-18)
  B-15 (Unicode), B-20 (no-console) have no code dependencies — can start in parallel
```

### Sequencing recommendation

```
Phase 17 ─────────────────────────────────────────────────────► ship anytime (independent)
Phase 18 ─────────────────────────────────────────────────────►
                                                                │
Phase 19 ──── requires Phase 18 complete ─────────────────────►
                                                                │
Phase 20 ──── requires Phase 19 complete (latency meaningful) ─►
                                                                │
Phase 21 ──── requires 18–20 complete (JSDoc covers new APIs) ─►
              B-15 and B-20 items can start alongside Phase 20
```

**Phase 17 does not block 18–20.** UAT CI infrastructure is orthogonal to feature work. Shipping Phase 17 first gives clean CI coverage of new tests, but it is not a hard prerequisite.

**Phase 21 partial parallelism:** B-15 (Unicode test coverage) and B-20 (no-console policy) are code-independent. They can begin during Phase 20. B-18 (JSDoc on public API) must wait until all new module APIs from 18–20 are stable.

---

## 7. Data Flow Diagram

```
/wrap command
  │
  └─► memory-extractor.js
        └─► extract candidates from session transcript
  │
  ▼
proposals/memory-proposals.md   (RIGHT side, direct fs write — bypasses vault-gateway)
  │
  │  [human reviews checkboxes in Obsidian]
  ▼
/promote-memories
  └─► promote-memories.js::promoteMemories()
        │
        ├─► isDuplicateInMemory()  — checks memory.md + archive by content_hash
        │
        ├─► appendToMemoryFile()   ──────────────────────────────────────────┐
        │     └─► memory/memory.md                                           │
        │           (RIGHT side, direct fs write)                            │
        │                                                                    │
        └─► [NEW Phase 19] indexNewEntries()  ◄─── called after appendToMemory
              └─► semantic-index.js
                    └─► Voyage AI API (embed promoted content)
                          └─► ~/.cache/second-brain/embeddings.jsonl
                                (outside vault, direct fs write)
                                                                            │
                               ┌────────────────────────────────────────────┘
                               │  memory/memory.md (grows over time)
                               │  ~/.cache/second-brain/embeddings.jsonl
                               ▼
              ┌────────────────────────────────────────────────────────┐
              │                   READ PATH (v1.4 new)                 │
              │                                                        │
              │  /recall "$query"                                      │
              │    └─► recall-command.js                               │
              │          ├─► semantic-index.js::semanticSearch()       │
              │          │     ├─► Voyage AI API (embed query)         │
              │          │     └─► cosine similarity vs embeddings.jsonl│
              │          │     [fallback if lock or Voyage unavailable] │
              │          │       memory-reader.js::searchMemoryKeyword()│
              │          └─► stdout (ranked entries + scores)          │
              │                                                        │
              │  /today (runToday in today-command.js)                 │
              │    └─► _fetchMemoryEcho()  [new private function]      │
              │          ├─► semanticSearch(query = synthesis text)    │
              │          │     [fallback] searchMemoryKeyword()        │
              │          └─► memoryEcho result object                  │
              │                 └─► renderBriefing(data.memoryEcho)    │
              │                       └─► briefing-renderer.js         │
              │                             _renderMemoryEchoSection() │
              │                             └─► ## Memory Echo         │
              │                                   in daily note        │
              │                                                        │
              │  daily-stats.js [called at end of runToday]            │
              │    └─► RIGHT/daily-stats.md (append-only row)          │
              │          columns: date | echoUsed | echoLatencyMs |    │
              │          memoryEntries | degradedSources               │
              └────────────────────────────────────────────────────────┘
```

---

## Component Boundary Summary

| Module | Status | Gateway Route | Storage | Called By |
|--------|--------|---------------|---------|-----------|
| `src/memory-reader.js` | NEW | direct fs.readFile | memory/memory.md (read-only) | recall-command.js, semantic-index.js, today-command.js |
| `src/semantic-index.js` | NEW | direct fs (cache path) | ~/.cache/second-brain/embeddings.jsonl | recall-command.js, today-command.js, promote-memories.js |
| `src/recall-command.js` | NEW | read-only | — | .claude/commands/recall.md |
| `src/daily-stats.js` | NEW | direct fs.appendFile | RIGHT/daily-stats.md | today-command.js |
| `src/today/briefing-renderer.js` | MODIFIED | — (renderer, no I/O) | — | today-command.js |
| `src/today-command.js` | MODIFIED | — (orchestrator) | daily note (existing path) | .claude/commands/today.md |
| `src/promote-memories.js` | MODIFIED | direct fs (existing pattern) | memory/memory.md (existing) | .claude/commands/promote-memories.md |
| `.claude/commands/recall.md` | NEW | — | — | user via /recall |
| `config/pipeline.json` | MODIFIED | — | — | all modules via loadConfigWithOverlay |
| `config/schema/pipeline.schema.json` | MODIFIED | — | — | AJV validation at config load |

---

## Open Questions

1. **Memory Echo query construction.** The synthesis text from `llm-augmentation.js` (passed into `renderBriefing` as `data.synthesis`) is the natural query — it summarizes today's priorities. An alternative is the frog text + top slippage project names (more keyword-friendly for fallback). This is a planning decision to resolve in Phase 18.

2. **Voyage model.** `voyage-3-lite` is the lowest-cost option (512 dimensions). If recall quality is insufficient, `voyage-3` (1024 dimensions) is the upgrade path. `config.memory.semantic.model` handles this without code changes.

3. **`daily-stats.md` bootstrap.** If `RIGHT/` is in `config.right`, `bootstrapVault()` in `vault-gateway.js` ensures the parent directory exists. If the stats path adds a subdirectory not in the config, `daily-stats.js` must call `fs.promises.mkdir({ recursive: true })` itself — same pattern as `appendToMemoryFile` in `promote-memories.js` line 186.

4. **Index size.** `voyage-3-lite` produces 512-dimension float32 vectors. At 1,000 memory entries the JSONL index is ~2MB; at 10,000 entries ~20MB. Both are trivially small for local disk. No sharding needed within the foreseeable vault lifetime.

---

## Sources

| Source | Type | Used For |
|--------|------|----------|
| `src/today-command.js` (direct read) | HIGH | Orchestration pattern, `_fanOut`/`_getPipelineState` private function pattern, `runToday()` return contract and line numbers |
| `src/today/briefing-renderer.js` (direct read) | HIGH | `renderBriefing()` data contract, `_render*` section naming convention, join array structure |
| `src/promote-memories.js` (direct read) | HIGH | `appendToMemoryFile()` at line 184, direct fs write pattern, `MEMORY_FILE` path construction at line 18, batch cap at line 329 |
| `src/vault-gateway.js` (direct read) | HIGH | `vaultWrite()` three-gate pipeline, `VAULT_ROOT` env pattern at line 44, `vaultRead()` three-tier model, precedent for bypassing gateway for internal writes |
| `config/pipeline.json` (direct read) | HIGH | Existing feature section shape, flat-object-per-feature naming convention |
| `.planning/PROJECT.md` (direct read) | HIGH | v1.4 milestone scope, key decisions table, phase numbering (17–21), Voyage AI decision |
