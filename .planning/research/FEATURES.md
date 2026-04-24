# Feature Landscape — v1.4 Memory Activation

**Domain:** CLI-first memory retrieval and value instrumentation for single-user markdown PKM
**Researched:** 2026-04-24
**Confidence:** HIGH for keyword search and instrumentation; MEDIUM for semantic search (Voyage AI integration is pre-GA pattern); MEDIUM for Memory Echo (relevance trigger heuristics require tuning)

> **Scope note:** This document covers ONLY the NEW features for the v1.4 milestone. Features already shipped in v1.0–v1.3 are not re-researched here. Existing behavior (write pipeline, /today 6 sections, /new routing, dead-letter retry) is preserved unchanged.

---

## Category A: Memory Read Path Foundation

### Table Stakes

These are the baseline capabilities users expect from any system that claims memory retrieval. Without them, the memory layer is write-only and has no output path.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `readMemory()` — parse memory.md into structured entries | Any read operation requires structured access to the data. The existing format (date headers, DECISION/LEARNING/etc. categories, frontmatter fields per entry) must be parsed into a queryable object array. | LOW | memory.md uses `## YYYY-MM` headers and per-entry frontmatter with `category::`, `source-ref::`, `content_hash::`, `added::` fields. Parser must handle the hybrid markdown + inline-field format. No new dependencies needed — fs + regex. |
| `listMemoryEntries()` — return entries with optional category and date filters | Users expect to filter by category (DECISION, LEARNING, etc.) and date range. This is table stakes for any structured data store. | LOW | Output: array of `{ id, category, content, date, sourceRef, contentHash }`. Category filter = exact match against the 7 defined categories. Date filter = compare `added::` field. Pure in-memory filter after `readMemory()`. |
| Graceful handling of empty or missing memory.md | The file may not exist in fresh installs. Retrieval functions must return empty results, not throw. | LOW | Already a pattern in the codebase (Promise.allSettled, graceful degradation). Mirror that convention. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Entry metadata exposure — `contentHash`, `sourceRef`, `confidence` from promotion | Allows downstream features (stats, dedup checks) to reference entries by stable ID rather than content. Already written at promotion time — just expose in read path. | LOW | `content_hash` is a 12-char SHA-256 prefix. `source-ref` is `session:<id>` or `file:<path>`. Both are already in memory.md per D-55/D-56. |

### Anti-Features

| Feature | Why Avoid | Alternative |
|---------|-----------|-------------|
| Full-text index rebuild on every read | Adds startup latency to /today and /recall. At current memory.md sizes (< 500 entries expected for 1 year), linear scan is fast enough. | Parse file on each call; add caching layer only when file exceeds 1000 entries. |
| SQLite or external DB for memory storage | Adds a dependency and a second source of truth diverging from the vault file. | memory.md is the canonical store. Embeddings index (Phase 19) is a derived cache, never the source of truth. |

---

## Category B: Keyword Memory Search

### Table Stakes

These match what users expect from any in-app search — Obsidian, Logseq, and Notion all provide these without configuration.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Case-insensitive substring match across entry content | Most fundamental search behavior. ripgrep and Obsidian both default to case-insensitive. | LOW | `.toLowerCase().includes(term)` after normalizing. No library needed. |
| Multi-word query support (AND semantics by default) | "decision typescript" should return entries containing both words, not either. Obsidian's default is AND across space-separated terms. | LOW | Split query on whitespace, require all terms present. Simple loop. |
| Ranked results — entries scored by term frequency | Users expect better matches first. A memory entry mentioning "TypeScript" 4 times should rank above one mentioning it once. | LOW | Score = sum of term occurrence counts across content. Stable sort descending. |
| Snippet extraction — return context around the match | Obsidian and ripgrep both show the matched line with surrounding context. Without snippets, user must open the full entry to evaluate relevance. | LOW | Extract a 100-char window centered on the first match occurrence. Truncate with ellipsis. |
| Category filter — restrict search to DECISION, LEARNING, etc. | Users want "recall my decisions about X" separately from "recall my learnings about X". | LOW | Pre-filter entries by category before scoring. Pass category as optional param to search function. |
| Date range filter | "What did I decide in March?" is a common recall pattern. | LOW | Filter by `added::` field before scoring. Accept ISO date strings. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Quoted phrase search — `"exact phrase"` treated as atomic | Logseq and Obsidian support quoted phrases. Power users expect it. Distinguishes `/recall "left vault"` (exact) from `/recall left vault` (AND). | LOW | Detect quoted segments with regex, treat as atomic substring rather than split terms. |
| Negation — `-term` excludes entries containing that term | ripgrep supports `!` prefix; many CLIs use `-`. Allows `/recall typescript -deprecated` to filter noise. | LOW | Prefix detection before scoring; exclude any entry matching a negated term regardless of score. |
| Source attribution display — show `session:` or `file:` ref for each result | Users want to know whether a memory came from a conversation or a vault file. Directly available from `source-ref` field. | LOW | Include in result object; render in /recall output as `(source: session:abc123)`. |

### Anti-Features

| Feature | Why Avoid | Alternative |
|---------|-----------|-------------|
| Fuzzy/typo-tolerant keyword search | Adds false positives in a structured single-user store. Memory entries are prose, not tags — typos are rare. | Use exact substring. Semantic search (Phase 19) covers the "didn't spell it exactly right" case via embeddings. |
| Full regex search exposed to CLI user | Too much surface area; risk of malformed regex crash. | Support only the three operator types: quoted phrase, negation, AND-joined terms. |
| Interactive fzf-style picker for /recall | Adds a runtime dependency (fzf binary) and breaks non-TTY invocations (scheduled tasks, pipes). | Display ranked results as numbered list. User reads and acts — no interactive picker needed for single-user CLI. |

### CLI Output Format

Standard pattern derived from ripgrep output format (`FILEPATH:LINE:CONTENT`) adapted for memory entries:

```
/recall typescript

Memory search: "typescript" — 3 results

[1] DECISION · 2026-04-18
    "Chose TypeScript strict mode for all new modules after ESLint caught 3 implicit any errors..."
    (source: session:abc123def)

[2] LEARNING · 2026-04-15
    "TypeScript discriminated unions eliminate the need for runtime type guards in classifier..."
    (source: file:Daily/2026-04-15.md)

[3] PATTERN · 2026-04-12
    "...use TypeScript const assertions for config objects to prevent mutation..."
    (source: session:789ghi)
```

Format rules:
- Numbered list, descending by score
- Category + date on header line
- 100-char snippet with ellipsis on second line
- Source ref in parentheses
- Empty result case: `No memories matched "query". Try broader terms or /recall --semantic query.`

**Dependency:** Requires Category A (`readMemory()`, `listMemoryEntries()`) — no standalone use.

---

## Category C: Semantic Memory Search

### Table Stakes

These match what users expect from any product claiming "semantic" search — Mem, Khoj, Obsidian Smart Connections all provide at minimum top-k cosine similarity retrieval.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Embedding-based similarity search returning top-k results | The baseline for semantic search. User query is embedded; cosine similarity computed against stored entry embeddings; top-k returned sorted by score. | MEDIUM | Uses Voyage AI `voyage-4-lite` (low latency, cost-efficient for high-volume reads). Query embedded with `input_type: "query"`, stored entries with `input_type: "document"`. |
| Score threshold filtering — suppress low-relevance results | Without a threshold, every query returns k results even when none are relevant. Obsidian Smart Connections uses a 0.75 default cosine threshold. | LOW | Configurable threshold (default: 0.72 cosine similarity). Results below threshold suppressed. If all below threshold, return "No strong semantic matches" + fallback to keyword. |
| Graceful degradation to keyword search when embeddings unavailable | Voyage AI API failure, rate limit, or missing index should not break /recall. The keyword path already exists (Category B). | LOW | Try semantic; on any error, log warning and fall back to keyword search. User sees `(keyword fallback — semantic unavailable)` notice. |
| Per-entry embedding computed at promotion time | Computing embeddings just-in-time at search query time would require embedding every memory entry on each /recall invocation. This is expensive and slow. | MEDIUM | Embeddings computed when entry is promoted from memory-proposals.md to memory.md. Stored in a sidecar index file `memory/memory-embeddings.jsonl` (one JSON line per entry: `{ contentHash, embedding, promotedAt }`). Re-used across all /recall calls. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Hybrid search — keyword BM25 score + semantic vector score fused via Reciprocal Rank Fusion | Current SOTA for local knowledge base retrieval (QMD, Qdrant, Elasticsearch all implement this). Catches cases where keyword search misses conceptual matches and semantic search misses exact-term matches. Research confirms +1.4x precision over either alone. | MEDIUM | RRF formula: `score = 1/(k + rank_keyword) + 1/(k + rank_semantic)` where k=60. No additional library needed — pure arithmetic after separate keyword and semantic rank lists. |
| Temporal decay — recency bonus applied to semantic scores | Research (TEMPR, MemoriesDB, 2025) shows temporal weighting improves practical recall relevance for personal memory systems. Recent memories are more likely to be relevant to current context. | LOW | `adjusted_score = base_score * (1 + decay_factor * recency_weight)` where recency_weight = `1 / (1 + days_since_promotion / 30)`. Configurable decay_factor (default: 0.2). Applied before threshold filtering. |
| Index refresh on memory.md update | Embeddings index stays current without manual intervention. New entries promoted to memory.md trigger automatic re-embedding of new entries only (delta update, not full rebuild). | LOW | Detect new entries by comparing contentHash values in memory.md against index. Embed only missing entries. Append to index file. |
| "Also see" hints — surface 1-2 semantically adjacent entries alongside top result | Obsidian Smart Connections surfaces related notes alongside the primary match. Increases memory density of a single /recall interaction. | LOW | After returning top-k, find entries above 0.60 threshold not in top-k. Show up to 2 as `Also see:` at end of output. |

### Anti-Features

| Feature | Why Avoid | Alternative |
|---------|-----------|-------------|
| Real-time embedding on /recall invocation | At 50+ memory entries, this adds 2-5 seconds of API latency per /recall call. Unacceptable for CLI workflow. | Compute at promotion time. Re-embed only on index rebuild command `/recall --rebuild-index`. |
| Local embedding model (sentence-transformers, llama.cpp) | Adds a Python/native dependency to a CJS Node.js project. Model download is 400MB+. Breaks zero-setup deployment. | Voyage AI API. Graceful degradation to keyword if unavailable. |
| Clustering or topic modeling of memory entries | Interesting research feature, low practical value for 50-500 entries. Adds complexity without proportionate UX benefit at this scale. | Surface category distribution in daily stats instead. |
| LLM re-ranking of semantic results | Adds 1-3 seconds of LLM call per /recall. Cost and latency not justified for single-user store. | RRF fusion of keyword + semantic handles the re-ranking problem adequately. |

**Data flow:**
```
Promotion (/promote-memories)
  → promote entry to memory.md
  → compute Voyage AI embedding (input_type: "document")
  → append { contentHash, embedding, promotedAt } to memory-embeddings.jsonl

/recall --semantic <query>  (or hybrid mode)
  → compute Voyage AI embedding for query (input_type: "query")
  → load memory-embeddings.jsonl
  → cosine similarity against all stored embeddings
  → apply temporal decay
  → filter by score threshold
  → merge with keyword rank list via RRF (hybrid mode)
  → return top-k with snippets
```

**Dependency:** Requires Category A (`readMemory()`) and promotion-time embedding hook. Category B (keyword) used as fallback path.

---

## Category D: /recall Command

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `/recall <query>` — single command, results to stdout | The user-facing surface for all memory retrieval. Should work like ripgrep: type a query, get results. | LOW | Dispatches to keyword search by default. Outputs formatted result list per Category B output format spec. |
| `--category <CAT>` flag to filter results | Users expect to narrow by memory type. | LOW | Pass through to Category A `listMemoryEntries()` filter. |
| `--since <YYYY-MM-DD>` flag for date range | Temporal filtering for "what did I learn this month?" | LOW | Pass through to Category A date filter. |
| `--top <N>` flag to control result count (default: 5) | Different contexts need different result density. | LOW | Cap result set at N after scoring. |
| `--semantic` flag to use semantic search | Opt-in for semantic until embeddings index is populated. Forces Voyage AI call. | MEDIUM | Requires Category C implementation. Falls back to keyword with notice if index empty. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| `--hybrid` flag — RRF fusion of keyword + semantic | Best retrieval quality. Opt-in since it requires both index and API availability. | MEDIUM | Uses Category C hybrid implementation. |
| `--rebuild-index` flag — force embedding recomputation for all entries | Recovery path when index is stale or corrupted. | LOW | Iterates all entries in memory.md, embeds each, overwrites memory-embeddings.jsonl. Progress indicator to stdout. |
| Empty-result suggestion — "Try broader terms or --semantic" | Users don't know to try semantic search if keyword fails. Surfacing the hint closes the discovery gap. | LOW | Detect zero results from keyword, append suggestion line. |

### Anti-Features

| Feature | Why Avoid | Alternative |
|---------|-----------|-------------|
| Interactive TUI (blessed, ink) | Adds a runtime dependency and breaks non-TTY contexts. Single-user CLI — ranked list is sufficient. | Numbered list output. User types `/recall` again with refined query. |
| `/recall edit <id>` — edit memory entries via /recall | /recall is a read command. Edits belong to the promotion workflow (/promote-memories). | Keep /recall read-only. Editing is a separate operation. |

---

## Category E: Memory Echo in /today

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Memory Echo section in /today briefing — 3-5 relevant memories injected between Frog and Pipeline | Users who run a second brain expect the morning briefing to surface relevant past knowledge, not just today's calendar. This is the "memory compounds daily" promise made visible. | MEDIUM | New section `## Memory Echo` added to briefing-renderer.js after `## Frog`. Must be gracefully degradable (if memory.md missing or empty, section is omitted — not an error). |
| Relevance trigger from today's calendar and email topics | The most actionable relevance signal available at /today runtime is what's on the user's calendar today. A meeting with "TypeScript architecture review" should pull DECISION entries containing "TypeScript". | MEDIUM | Extract key nouns/topics from calendar event titles and VIP email subjects (already available as connector results). Run keyword search against memory.md with those topics. No additional LLM call required. |
| "N memories surfaced" count in /today one-line summary | Users want to know at a glance whether memory echo found anything. The one-line summary ("Yesterday: +N proposals, +M promotions, +X KB memory") gets a fourth stat: "N echoed". | LOW | Append to stats line after memory echo search completes. Zero-result case: omit echo count from stats line. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Topic extraction from /new inputs in the last 24 hours | If the user captured several items via /new yesterday, those topics are a strong signal for today's Memory Echo relevance. Better than calendar alone since /new captures what the user was thinking, not just scheduled events. | MEDIUM | Read classifier output log or vault files written in last 24h. Extract noun phrases as search terms. Combine with calendar topics via union (OR semantics). Requires reading recently written right-vault files. |
| Recency bonus for recent promotions in Memory Echo selection | Memories promoted in the last 7 days deserve extra surfacing — the user just reviewed them. Acts as a lightweight spaced-repetition trigger. | LOW | Apply `recency_bonus = 1.5` multiplier to entries with `promoted_at` within 7 days before ranking for Memory Echo. Simple date comparison. |
| Graceful section omission when no relevant memories found | An empty Memory Echo section is worse than no section. "Nothing relevant found" wastes screen space. | LOW | If zero results above relevance threshold (0.65 keyword match or 0.70 semantic), omit the `## Memory Echo` section entirely from the briefing output. |

### Anti-Features

| Feature | Why Avoid | Alternative |
|---------|-----------|-------------|
| LLM call to determine Memory Echo relevance | Adds 1-3 seconds and API cost to every /today execution. /today runs at 6:45 AM on a schedule — latency matters. | Use keyword search against calendar/email topics. Semantic search as opt-in only. |
| User-configurable Memory Echo size | Config surface area for a 3-5 item section is over-engineering. | Hardcode at 5 items max. Revisit in v1.5 if Pete requests it. |
| Showing full memory entry content in briefing | Too verbose. Memory Echo is a prompt for recall, not a replacement for it. | Show category, date, first 80 chars of content, and "(see /recall for full entry)". |

**Dependency:** Requires Category A (`readMemory()`, `listMemoryEntries()`). Category B (keyword search) used for relevance matching. Category C (semantic) can enhance but is not required for initial Memory Echo. Calendar connector results (already available) used as topic source. No new connectors needed.

**Rendering position in briefing:**
```
## Frog
[frog content]

## Memory Echo          ← NEW
[3-5 relevant memories]

## GitHub
[github content]

## Pipeline
[pipeline content]
```

---

## Category F: Value Extraction Instrumentation

### Table Stakes

These are the metrics that answer "is this knowledge base actually compounding?" — the question that justifies the system's existence.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `daily-stats.md` — append-only table tracking daily memory activity | Any system claiming "memory compounds daily" must be able to show the compounding. Anki shows retention rate and interval growth. Obsidian Dataview users build note-count dashboards. The minimum viable proof of compounding is a growth chart. | LOW | Append one row per day to `memory/daily-stats.md`. Format: markdown table with columns: `date`, `proposals`, `promotions`, `total_entries`, `memory_kb`, `recall_count`. Written by a `stats-append` function called at /wrap (proposals+promotions data) and at /recall (recall_count). |
| Total entry count and memory.md file size tracked over time | The most visible compounding metric. Users should be able to see "memory grew from 50 to 147 entries in 30 days". | LOW | `total_entries` = count of entries in memory.md at time of write. `memory_kb` = `fs.statSync(MEMORY_FILE).size / 1024` rounded to 1 decimal. Both computed at /wrap time. |
| Proposal → promotion velocity | How many of the day's proposals got promoted? Low ratio = proposals are too noisy or user review is not happening. High ratio = pipeline is healthy. | LOW | `proposals` = count of candidates written to memory-proposals.md in the last 24h (can be tracked by reading candidateIds with today's date prefix from the file). `promotions` = count of entries promoted today (read from memory.md by `added::` date). |
| /today one-line summary — "Yesterday: +N proposals, +M promotions, +X KB memory" | Users want a single-line proof of yesterday's knowledge activity in the morning briefing. Anki does this with "You reviewed N cards yesterday". This is the equivalent for knowledge capture. | LOW | Read last row of daily-stats.md at /today runtime. Format as one-liner prepended to or appended to the Pipeline section header, or as a standalone line below the synthesis blockquote. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Promotion latency tracking — time from proposal to promotion | Fast-closing proposals (< 1 day) indicate the user is actively maintaining their memory. Stale proposals (> 7 days) indicate review debt. SuperMemo tracks interval growth; this is the analogous metric for the manual review gate. | MEDIUM | Requires proposal write timestamp (already captured as part of candidateId prefix: `mem-YYYYMMDD-NNN`) and promotion timestamp (`added::` field in memory.md). Delta = promotion_date - proposal_date in hours. Store p50/p90 latency in daily-stats row. |
| Recall count per day — how often /recall is used | Retrieval success is the ultimate test of a knowledge base. If /recall is never used, the read path has no value. Track count to detect adoption. | LOW | Increment `recall_count` in today's stats row each time /recall is invoked. Stats row created if missing (first /recall of day). |
| Memory KB growth rate — rolling 7-day average | Point-in-time KB is noisy (depends on entry length). 7-day rolling average shows trend. | LOW | Computed at /today read time from last 7 rows of daily-stats.md. Displayed as "+X KB/week" in the summary line. |

### Anti-Features

| Feature | Why Avoid | Alternative |
|---------|-----------|-------------|
| Retrieval success rate tracking (did the user find what they needed?) | Requires user feedback after each /recall — adds friction to a zero-friction retrieval command. Single-user system with no implicit feedback signal. | Track recall_count as a proxy for engagement. If /recall is used frequently, the read path has value. |
| LLM-based quality scoring of memory entries | Expensive, adds latency to promotion, and the confidence score from extraction already serves as a quality signal. | Use confidence score from memory-extractor.js (already 0.0–1.0) as quality proxy. Track average confidence of promoted entries in stats if needed. |
| Dashboard UI / chart rendering | Adds dependencies (Chart.js, canvas) for a feature a single user accesses weekly at most. | Markdown table in daily-stats.md is readable and Dataview-compatible. If Pete wants a chart, Obsidian Dataview can render one from the table without code changes. |
| Real-time metrics streaming | Adds complexity for a single-user offline-first system. | Append-only file updated at /wrap and /recall invocations. /today reads and displays yesterday's row. |

### daily-stats.md Format

```markdown
# Memory Stats

| date | proposals | promotions | total_entries | memory_kb | recall_count | avg_latency_hrs |
|------|-----------|------------|---------------|-----------|--------------|-----------------|
| 2026-04-24 | 3 | 2 | 47 | 12.4 | 1 | 18.5 |
| 2026-04-25 | 5 | 4 | 51 | 13.1 | 3 | 6.2 |
```

Written by: `stats-append.js` (new module). Called from:
- `/wrap` hook: writes proposals + promotions + total_entries + memory_kb
- `/recall` invocation: increments recall_count for today's row (upsert pattern)

**Dependency:** Requires Category A (`readMemory()` for total_entries count). No dependency on Category B, C, or D.

---

## Feature Dependencies

```
Category A: Memory Read Path (readMemory, listMemoryEntries)
  └── required by ──> Category B: Keyword Search
  └── required by ──> Category C: Semantic Search
  └── required by ──> Category D: /recall Command
  └── required by ──> Category E: Memory Echo in /today
  └── required by ──> Category F: Instrumentation (total_entries count)

Category B: Keyword Search
  └── required by ──> Category D: /recall (default mode)
  └── required by ──> Category E: Memory Echo relevance matching

Category C: Semantic Search
  └── enhances ──> Category D: /recall (--semantic, --hybrid modes)
  └── enhances ──> Category E: Memory Echo (optional improvement)
  └── requires ──> Voyage AI API (VOYAGEAI_API_KEY env var)
  └── requires ──> memory-embeddings.jsonl sidecar (computed at promotion time)

Category D: /recall
  └── enhances ──> Category F: Instrumentation (recall_count)
  └── no dependency on ──> Category E (independent command)

Category E: Memory Echo
  └── requires ──> Category A, Category B
  └── requires ──> calendar connector results (already in /today data flow)
  └── enhances with ──> Category C (optional, not blocking)

Category F: Instrumentation
  └── requires ──> Category A (entry count)
  └── no dependency on ──> Categories B, C, D, E
```

### Dependency Notes

- **Category A is the foundation:** readMemory() and listMemoryEntries() must ship in Phase 18 before any other category can be implemented.
- **Category C (semantic) can ship in Phase 19 without blocking Phase 18:** keyword search provides a functional /recall immediately. Semantic is an enhancement.
- **Category E (Memory Echo) can ship with keyword-only relevance:** semantic enhancement is additive, not required for initial Memory Echo.
- **Category F (instrumentation) is independent** except for the entry count (readMemory). Stats can be implemented in parallel with Categories B-E.
- **The promotion hook for embeddings (Category C)** must be added to promote-memories.js as part of Phase 19, not Phase 18. Phase 18 should not modify the promotion path.

---

## MVP Definition for v1.4

### Must ship (Phase 18 + 20)

- [x] `readMemory()` and `listMemoryEntries()` — Category A foundation
- [x] Keyword search with multi-word AND, quoted phrase, negation — Category B
- [x] `/recall <query>` command with `--category`, `--since`, `--top` flags — Category D (keyword mode)
- [x] Memory Echo section in /today using keyword relevance from calendar topics — Category E (keyword mode)
- [x] `daily-stats.md` append-only stats with proposals, promotions, total_entries, memory_kb — Category F
- [x] /today one-line "Yesterday: +N proposals, +M promotions, +X KB memory" summary — Category F

### Add in Phase 19 (semantic layer)

- [ ] Voyage AI embedding at promotion time — Category C prerequisite
- [ ] `memory-embeddings.jsonl` sidecar index — Category C
- [ ] `/recall --semantic` and `/recall --hybrid` flags — Category C + D
- [ ] Temporal decay applied to semantic scores — Category C differentiator
- [ ] Graceful degradation from semantic to keyword — Category C

### Enhance after Phase 19 (if time)

- [ ] Memory Echo upgraded to use hybrid search for relevance — Category E differentiator
- [ ] Promotion latency tracking in daily-stats — Category F differentiator
- [ ] `--rebuild-index` flag on /recall — Category D differentiator
- [ ] "Also see" hints in semantic results — Category C differentiator

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Phase | Priority |
|---------|------------|---------------------|-------|----------|
| readMemory() + listMemoryEntries() | HIGH | LOW | 18 | P1 |
| Keyword search (AND, phrase, negation) | HIGH | LOW | 18 | P1 |
| /recall command (keyword mode) | HIGH | LOW | 18 | P1 |
| Memory Echo in /today | HIGH | MEDIUM | 18 | P1 |
| daily-stats.md append-only table | HIGH | LOW | 20 | P1 |
| /today one-line stats summary | MEDIUM | LOW | 20 | P1 |
| Voyage AI embedding at promotion | MEDIUM | MEDIUM | 19 | P2 |
| /recall --semantic / --hybrid | MEDIUM | MEDIUM | 19 | P2 |
| Temporal decay on semantic scores | MEDIUM | LOW | 19 | P2 |
| Graceful semantic → keyword fallback | HIGH | LOW | 19 | P2 |
| Promotion latency tracking | LOW | MEDIUM | 20 | P3 |
| "Also see" hints | LOW | LOW | 19 | P3 |
| /recall --rebuild-index | LOW | LOW | 19 | P3 |
| RRF hybrid fusion | MEDIUM | MEDIUM | 19 | P2 |
| /today recall count in stats line | LOW | LOW | 20 | P3 |

---

## Comparison: How PKM Apps Handle These Features

### Keyword Search

| System | Search Model | Operators | Output Format |
|--------|-------------|-----------|---------------|
| Obsidian (core) | Case-insensitive substring, live filter | file:, path:, tag:, line:, section:, content: | File list with matched-line snippets |
| Logseq | Block-level full text | AND/OR, double quotes for phrases | Block cards with context |
| Notion | Database filters + full text | AND/OR/NOT | Row cards |
| **This project** | Entry-level substring with scoring | AND (space), quoted phrase, negation (-) | Numbered list with 100-char snippet |

Obsidian's `content:` operator restricts to note body (excluding frontmatter). For memory.md, all search is over entry content — the equivalent of `content:` always being on.

### Memory Echo / Relevant Memory Surface

| System | How Triggered | What It Shows | Source |
|--------|--------------|---------------|--------|
| Reflect | AI surfaces "related notes" after each capture | Notes with embedding similarity to current page | Semantic |
| Mem | "Similar memories" in sidebar | Recent + semantically similar memories | Hybrid |
| Obsidian Smart Connections | Plugin shows related notes in side panel | Top cosine similarity from local embeddings | Semantic |
| NotePlan | "Review" section surfaces notes from 1 week/1 month ago | Pure recency | Date |
| **This project** | /today Morning Echo section | Keyword match to today's calendar/email topics | Keyword → upgrade to hybrid |

The calendar-topic-triggered approach is unique. Other systems use either pure recency or pure semantics; this project uses today's agenda as a relevance filter, which is context-aware without requiring a separate semantic call at /today runtime.

### Instrumentation / Growth Metrics

| System | What It Tracks | Display |
|--------|----------------|---------|
| Anki | Cards due, retention rate (R), stability (S), ease factor | Stats dashboard with graphs |
| Obsidian Dataview | User-defined — note count, tag frequency, date ranges | Markdown/JS query rendered inline |
| SuperMemo | Interval growth, forgetting index, expected retention | Detailed tables per card |
| Mem | Total memories, weekly additions | Simple counter |
| **This project** | Proposals, promotions, total entries, KB, latency, recall count | Append-only markdown table (Dataview-compatible) |

The daily-stats.md markdown table approach is the right call: it requires no plugin, is human-readable, and can be visualized later by Obsidian Dataview without code changes. Anki's full spaced-repetition scheduling (R, S, ease factor) is not applicable to a non-interactive review system — we track the analogous metric (promotion latency) as a proxy.

---

## Sources

### Primary (HIGH confidence)
- `/Users/cpconnor/projects/second-brain/src/memory-extractor.js` — entry structure (7 categories, confidence 0.0–1.0, source-ref schema)
- `/Users/cpconnor/projects/second-brain/src/memory-proposals.js` — candidateId format (`mem-YYYYMMDD-NNN`), content_hash algorithm (SHA-256 prefix 12 chars), MEMORY_FILE path
- `/Users/cpconnor/projects/second-brain/src/today/briefing-renderer.js` — rendering pipeline, section order (Meetings, VIP Emails, Slippage, Frog, GitHub, Pipeline), graceful degradation pattern
- `/Users/cpconnor/projects/second-brain/.planning/PROJECT.md` — v1.4 target features, Voyage AI decision, out-of-scope list, key architectural decisions
- Live memory.md inspection — confirmed `## YYYY-MM` header format, per-entry `category::`, `source-ref::`, `content_hash::`, `added::` inline fields

### Secondary (MEDIUM confidence)
- Voyage AI docs (fetched 2026-04-24) — voyage-4-lite recommended for latency/cost, `input_type: "query"` vs `"document"` distinction, `voyageai` npm package available
- QMD project (GitHub) — confirmed BM25 + vector hybrid with RRF fusion as the Node.js-native pattern for markdown knowledge bases; 3-search-mode architecture validates the keyword/semantic/hybrid split
- Hybrid Search Guide (supermemory.ai, 2026) — confirms +1.4x precision improvement and ~6ms additional latency for hybrid vs single-mode search
- Obsidian Search documentation — confirms case-insensitive default, operator syntax, snippet display format
- WebSearch: ENGRAM, MemoriesDB, TEMPR (2025) — confirm top-k + score threshold + temporal decay as standard patterns for agent memory retrieval systems

### Tertiary (LOW confidence)
- Anki/SuperMemo metric descriptions from WebSearch — specific FSRS R/S/D values not directly applicable; abstracted to "promotion latency" as the analogous metric
- PKM tool comparisons (Mem, Reflect, NotePlan behavior) — from training data cross-referenced with 2025 search results; specific product features may have changed

---

*Feature research for: v1.4 Memory Activation — memory retrieval and value instrumentation*
*Researched: 2026-04-24*
