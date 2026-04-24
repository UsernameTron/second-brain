# Pitfalls Research

**Domain:** Embedding-based memory search + instrumentation added to existing markdown vault (v1.4 additions)
**Researched:** 2026-04-24
**Confidence:** HIGH (domain-specific research on Voyage AI, vector index design, HNSW/flat index mechanics, RAG instrumentation, Obsidian sync behavior, CI/CD embedding test patterns)

> **Scope note:** This document covers pitfalls specific to v1.4 additions — Voyage AI embeddings, local vector index, `/recall`, Memory Echo, and daily-stats.md instrumentation. For v1.0–v1.3 pitfalls (vault write-permission boundary, exclusion filtering, MCP gateway failure, memory contamination, anti-AI style guide, OAuth security), see git history for the original PITFALLS.md dated 2026-04-21.

---

## Critical Pitfalls

### Pitfall 1: Embedding Drift When Memory Schema Evolves

**What goes wrong:**
`memory.md` entry format changes — new frontmatter field added, category renamed, date format shifted — but the vector index was built against the old format. Old embeddings stay valid at the vector level (the math is fine) but now represent a different semantic surface than new embeddings. Cosine similarity comparisons between old-format and new-format entries produce misleading scores: two semantically identical memories score lower than expected because one has extra frontmatter tokens the model weighted differently.

In practice: a `/recall` query returns a memory from six months ago ranked above a directly relevant recent memory because the recent entry uses the new schema and the similarity scoring is now comparing apples to oranges.

**Why it happens:**
Developers treat the index as an append-only artifact and evolve the schema without thinking about the existing vectors. The problem is invisible in unit tests (which test the new format only) and only surfaces at query time when old entries misbehave. ChromaDB auto-migrates its own SQLite schema but does not re-embed content when your document schema changes — that responsibility is entirely on the application.

**How to avoid:**
- Store a `schema_version` field in the index metadata (e.g., a JSON sidecar file at `.index/metadata.json`). On startup, compare the schema version of the running code against the persisted version.
- If schema version mismatches: trigger a full re-embed pass before returning any results. Do not silently serve stale embeddings.
- For v1.4, memory.md entries are currently minimal (13 lines, no frontmatter). Lock the entry schema as part of Phase 18 and document it. Do not add frontmatter fields after Phase 19 ships embeddings without a re-index plan.
- Use a content hash per entry (SHA-256 of the raw entry text) stored alongside the vector. On read, recompute the hash and compare. If mismatch, queue that entry for lazy re-embedding rather than rebuilding everything.

**Warning signs:**
- `/recall` returning old entries ranked higher than clearly more-relevant recent ones
- New memory entries performing differently in recall than expected
- Schema changes to memory.md made without a corresponding JIRA/issue tracking re-index

**Phase to address:** Phase 19 (Semantic Memory Search) — index metadata schema and version-check logic must be implemented before the index goes live, not retrofitted later.

---

### Pitfall 2: Index Bloat and Load Time

**What goes wrong:**
Voyage-3 embeddings are 1024 dimensions * 4 bytes = 4 KB per entry. At 10,000 entries the raw vector data is 40 MB. For an HNSW index, add the graph structure: memory per vector = (d * 4 + M * 2 * 4) bytes where d=1024 and M=16 (typical), yielding ~12 KB per vector — 120 MB for 10K entries. Loading this into memory on every `/today` run (cron-triggered, cold start) adds a noticeable startup delay.

At current scale (13 entries) this is irrelevant. At 500 entries (about one year of daily use) it is still fine. The trap is building the system in a way that loads the full index eagerly on every operation, so the problem is invisible until the user has years of memories and suddenly `/today` takes 45 seconds to start.

**Why it happens:**
Developer builds the happy path at 13 entries, ships Phase 19, and never tests at 500+. The lazy-loading architecture that would fix this is harder to build correctly, so the simple "load index at startup" approach ships instead.

**How to avoid:**
- For a single-user personal vault, a flat (brute-force) index is adequate through at least 10,000 entries. At 4 KB/entry, 10K entries = 40 MB — acceptable in RAM. Use HNSW only if query latency at 10K+ entries becomes measurable (benchmark first, optimize second).
- Load the index lazily on first `/recall` or Memory Echo invocation, not at `/today` startup. The cold-start path should not pay the index-load cost unless memory retrieval is actually needed.
- Cache the in-memory index across invocations using a module-level singleton. Node.js process lifetime determines cache validity — on cron cold starts, this means re-loading each run, which is acceptable at current scale.
- Document the scale thresholds in code comments: "at 5K entries, consider HNSW; at 50K entries, consider sqlite-vec or a proper vector DB."

**Warning signs:**
- `/today` startup time increasing week over week
- Memory Echo section appearing 10+ seconds after other sections complete
- Index load happening on every API call rather than being cached

**Phase to address:** Phase 19 (Semantic Memory Search) — index loading strategy must be designed upfront, not optimized later.

---

### Pitfall 3: Cost Runaway via Re-Embedding on Every Run

**What goes wrong:**
The `/today` cron task calls the Voyage API to embed the full `memory.md` corpus on every morning run. At 200 entries, that is 200 API calls per day. At 365 days, that is 73,000 embedding calls for content that changes by at most 5–10 entries daily. At Voyage voyage-4-lite pricing ($0.02/MTok), the waste is negligible at low token counts — but the architectural mistake is embedding unchanged content repeatedly, which will eventually matter as the corpus grows.

More concretely: if someone re-embeds a 500-entry corpus every morning, and each entry averages 200 tokens, that is 100K tokens/day = 36.5M tokens/year. Still within the 200M free tier. But if the scheduler fires multiple times due to a bug (the dead-letter retry pattern already exists in this codebase), you burn through the free tier unexpectedly.

**Why it happens:**
The simplest implementation re-embeds everything each time rather than tracking what has changed. The problem is compounded by the fact that the free tier is generous enough that the cost is invisible until it suddenly isn't.

**How to avoid:**
- Cache embeddings keyed by content hash (SHA-256 of the entry text). Before calling the Voyage API, check if a cached embedding exists for that hash. Only embed entries that are new or have changed.
- Persist the hash-to-embedding cache in `.index/embeddings.json` (or a SQLite file). On incremental runs, only entries whose hash is absent or changed get re-embedded.
- Implement a per-run embedding budget: cap at N new embeddings per `/today` invocation. If more than N new entries exist (e.g., after a bulk import), queue the remainder for the next run.
- Add an emergency kill-switch: if total Voyage API calls in a 24-hour window exceed a threshold (e.g., 500 calls), pause embedding and alert via the briefing. The existing dead-letter freeze semantics in this codebase are the right pattern to adapt.

**Warning signs:**
- Embedding call count per run equals total corpus size (not just new entries)
- No content-hash-to-vector cache file in `.index/`
- Voyage API dashboard showing token consumption growing linearly with corpus size instead of incrementally with new entries
- Dead-letter retry loop triggering re-embed passes

**Phase to address:** Phase 19 (Semantic Memory Search) — incremental indexing must be the default design, not an optimization added later.

---

### Pitfall 4: Re-Indexing Thrash and Lock Contention

**What goes wrong:**
Memory extraction runs after every session. `/promote-memories` writes new entries to `memory.md`. chokidar (already in this codebase) watches `memory.md` for changes. If the index-rebuild is wired to trigger on every `memory.md` change event, a `/promote-memories` run that promotes 5 entries fires 5 rapid-succession change events, each triggering a re-index. Five concurrent re-index passes try to write to `.index/embeddings.json` simultaneously — file corruption or EBUSY errors result.

The existing dead-letter retry infrastructure makes this worse: if the re-index fails due to a lock, it retries. The retry fires another re-index. The retry loop and the file-watcher loop can create a feedback cycle where the system is continuously re-indexing while the user is trying to run `/recall`.

**Why it happens:**
File-watcher-triggered re-indexing is the obvious pattern, but it does not account for burst writes. The lock contention between the promoter and the indexer is invisible in single-threaded unit tests.

**How to avoid:**
- Debounce the re-index trigger: coalesce change events over a 2-second window before starting a re-index. This turns 5 rapid promotions into a single re-index pass.
- Use an exclusive file lock (or a `.index/.lock` sentinel file) before starting any re-index operation. If the lock is held, skip and schedule a retry after the debounce window.
- Do NOT wire re-indexing to the file watcher in the default configuration. Instead, run re-indexing as a discrete step within `/promote-memories` itself — after all promotions are written, trigger a single incremental index update. This gives deterministic behavior and avoids the chokidar feedback loop.
- Log index operations with start/end timestamps. If start-to-start time is less than the debounce window, a feedback loop is forming.

**Warning signs:**
- EBUSY or ENOTEMPTY errors in `.index/` directory during promotion
- Index rebuild time appearing in logs faster than the debounce window allows
- `/recall` returning errors during or immediately after `/promote-memories` runs
- chokidar emitting multiple `change` events per single `/promote-memories` invocation

**Phase to address:** Phase 19 (Semantic Memory Search) for indexing architecture; Phase 18 (Memory Retrieval Foundation) for the promotion-indexing handoff contract.

---

### Pitfall 5: Graceful Degradation When Voyage Is Offline

**What goes wrong:**
Voyage AI goes offline (timeout, 429 rate limit, 500 server error, DNS failure, missing `VOYAGE_API_KEY` env var). `/recall` is called. It tries to embed the query, fails, throws an uncaught error, and crashes the `/today` orchestration chain — taking down the Memory Echo section and potentially the rest of the briefing.

The existing graceful-degradation pattern in this codebase (LLM classify() never throws, returns `{success, data/error, failureMode}`) is the right model but needs to be applied here too. The risk is treating the Voyage client as a simple synchronous dependency rather than a remote call that can fail.

**Why it happens:**
API clients feel synchronous in development (fast network, API key present). The failure modes only appear in production (flaky network, rate limits under load, key misconfigured in cron environment). The Obsidian QMD plugin's BM25 fallback pattern shows this is a known pattern in the Obsidian ecosystem — but it requires explicitly building the fallback path, not assuming the API will work.

**How to avoid:**
- Wrap all Voyage API calls in the same `{success, data/error, failureMode}` pattern already used for LLM calls. The wrapper catches all error types: network timeout, HTTP 4xx/5xx, missing API key, JSON parse failure.
- Define the fallback hierarchy explicitly: semantic search (Voyage) → keyword search (existing `/recall` keyword mode) → graceful omission of Memory Echo from briefing. Each fallback level logs a degradation notice.
- Classify failure modes by recoverability:
  - `VOYAGE_KEY_MISSING`: permanent until config fix — skip embedding, do not retry
  - `VOYAGE_RATE_LIMIT (429)`: transient — back off 60s, retry once
  - `VOYAGE_TIMEOUT`: transient — retry once with doubled timeout
  - `VOYAGE_SERVER_ERROR (5xx)`: transient — retry once, then fall back to keyword
- The Memory Echo section in `/today` must be marked as optional. If semantic search is unavailable, the briefing continues with keyword-only recall and a one-line notice: "Memory Echo: Voyage unavailable — showing keyword results."

**Warning signs:**
- `/today` throwing unhandled promise rejections when VOYAGE_API_KEY is unset
- Memory Echo crashing the entire briefing instead of degrading gracefully
- No logging of Voyage API failure mode (just "failed")
- `/recall` not having a keyword fallback path

**Phase to address:** Phase 19 (Semantic Memory Search) — degradation contract must be defined in the same phase as the Voyage integration, not as a follow-up.

---

### Pitfall 6: Query Embedding Privacy — Sensitive Text Sent to Voyage

**What goes wrong:**
`/recall` embeds user query text and sends it to the Voyage API (a cloud service). If a user types `/recall ISPN contract renewal timeline`, the literal string "ISPN contract renewal timeline" is transmitted to Voyage's servers and (by default) may be retained for model training.

This violates the project's zero-trust posture. The ingress filter at `/new` strips excluded content before writing to the vault — but that filter does not intercept `/recall` queries.

Research finding: Voyage AI stores API data for model training by default. Opt-out requires a payment method on file and an explicit admin toggle. Additionally, research shows that 40% of sensitive data in sentence-length embeddings is recoverable via inversion attacks — meaning even if Voyage "zeroes" the data, the embedding itself leaks information.

**Why it happens:**
The exclusion filter was designed for the write path (`/new` ingress) and is not applied to the query path. Query text feels ephemeral — it is not written to the vault — so the same scrutiny is not applied.

**How to avoid:**
- Apply the same excluded-terms filter to `/recall` query text before embedding. If the query contains excluded terms (ISPN, Genesys, Asana, and all synonyms), either: (a) strip the excluded term and embed the remainder, or (b) refuse to embed and fall back to keyword-only search with a notice: "Query contains excluded content — semantic search skipped."
- Configure Voyage AI's zero-day data retention immediately on account setup (toggle Opted Out in the dashboard). Document this as a required setup step in Phase 19.
- Log that the opt-out toggle was verified — treat it as a security gate, not an optional preference.
- For paranoid mode: run queries through the existing exclusion filter and hash the excluded terms before embedding. This does not protect against inversion of non-excluded content but closes the most obvious leak.

**Warning signs:**
- `/recall` queries not passing through the exclusion filter before embedding
- Voyage account in default "Opted In" data retention mode
- No documented setup step for data retention opt-out in Phase 19 plan
- Query text appearing in server-side logs at Voyage (not directly observable, but implied by default retention policy)

**Phase to address:** Phase 19 (Semantic Memory Search) — opt-out setup and query-path exclusion filter are prerequisites, not post-launch hardening.

---

### Pitfall 7: Index Portability and Sync Conflicts

**What goes wrong:**
The `.index/` directory lives inside `~/Claude Cowork/memory/.index/`. If the vault is synced via iCloud, Dropbox, or Obsidian Sync, the binary/JSON index files sync across devices. On multi-device access (desktop + laptop), both devices have a local index. If Pete runs `/promote-memories` on the laptop and `/today` on the desktop, both attempt to write to `.index/embeddings.json` simultaneously through iCloud's eventual-consistency sync. iCloud's conflict resolution creates a duplicate file (`embeddings 2.json`), corrupting the index silently.

Additionally: if the vault is git-controlled (it is not in this project, but adjacent repos are), committing `.index/` creates large binary diffs on every embedding run, bloating git history.

**Why it happens:**
The `.index/` path is chosen for co-location with the vault, which feels natural. But vault sync tools (iCloud, Obsidian Sync, Dropbox) are designed for small markdown files, not multi-MB binary/JSON files that change on every session. Their conflict resolution is text-oriented and breaks on JSON that cannot be line-merged.

**How to avoid:**
- Store `.index/` outside the vault directory: `~/projects/second-brain/.index/` (in the code project, which is not synced through Obsidian Sync). This decouples the index from the vault sync path entirely.
- If the index must live in the vault directory for co-location reasons, add `.index/` to Obsidian Sync's excluded paths and to any iCloud/Dropbox exclusion mechanism.
- The index is always rebuildable from `memory.md`. Treat it as a derived artifact, not a primary artifact. If the index is lost or corrupted (sync conflict), rebuild it. Document the rebuild command.
- Add a startup integrity check: if the index file exists but cannot be parsed as valid JSON, delete and rebuild rather than crashing.

**Warning signs:**
- `embeddings 2.json` appearing in `.index/` (iCloud conflict copy)
- Index file size growing in Obsidian Sync's bandwidth usage
- "Unable to parse index" errors in `/recall` after multi-device use
- Git commits showing large binary diffs if `.index/` is ever tracked

**Phase to address:** Phase 19 (Semantic Memory Search) — index storage path is an architecture decision that must be made before the index is created.

---

### Pitfall 8: Append-Only daily-stats.md Growing Unbounded

**What goes wrong:**
`daily-stats.md` receives one appended row per day. At one row per day, after 10 years that is 3,650 rows — manageable. But if the append logic fires on every `/today` run (including re-runs, retries, and the dead-letter retry loop), the file can receive multiple rows per day. After a year of occasional duplicates and retry-triggered rows, the file has 1,000+ rows and Dataview queries over it become slow. More critically, the file becomes unreliable as a data source because duplicate rows are hard to detect in a Dataview table.

Separately: a 3,650-row markdown file is ~300KB — trivial for a text file, but if Obsidian re-indexes it on every append (which it does), it causes a burst of indexer activity on a file that changes daily.

**Why it happens:**
Append-only is correctly chosen for auditability. The mistake is not gating the append with an idempotency check (has a row for today already been written?).

**How to avoid:**
- Before appending to `daily-stats.md`, read the last row and check if it has today's date. If yes, update that row rather than appending a new one. This keeps the file strictly one-row-per-day.
- Use ISO 8601 date as the row key: `2026-04-24 | ...`. Parsing and deduplication become straightforward.
- Dataview queries over a 3,650-row file are fast (Dataview uses a cached index). The performance concern is real only if Dataview is querying across the full file and sorting/filtering on every vault open. Scope the query to the last 90 days for the dashboard view; let the full file serve as the archive.
- Do not add the date column as a timezone-local timestamp. Use UTC date only, or explicitly use the user's local date — but be consistent. The `/today` cron fires at a configured time; if that time is near midnight and the system clock is in a different timezone from the date-calculation logic, rows will be attributed to the wrong day.

**Warning signs:**
- Multiple rows with the same date in `daily-stats.md`
- Row count growing faster than one per calendar day
- Dataview query over `daily-stats.md` rendering differently on different days without apparent cause (timezone boundary artifact)

**Phase to address:** Phase 20 (Value Extraction Instrumentation) — idempotency check and date-handling logic are correctness requirements, not optimization.

---

### Pitfall 9: Timezone Bugs Across Midnight Boundaries

**What goes wrong:**
`/today` cron fires at 6:00 AM. If the system timezone and the JavaScript runtime timezone differ (common in containerized or SSH-remote execution), `new Date()` returns a different date than the user's local date. A row appended at 6:00 AM PST (UTC-8) with `new Date().toISOString()` shows as `2026-04-24T14:00:00Z` — the correct UTC time, but if the date extraction uses `getDate()` without timezone offset, it returns April 24 in PST but the ISO string shows April 24 at 14:00 UTC. Consistent, but if any other component uses `getUTCDate()`, the two systems disagree on "today."

In this specific codebase: RemoteTrigger schedules `/today` in the user's local timezone, but the Node.js process that runs the code may use the system timezone (which may differ if Claude Desktop runs as a sandboxed app).

**Why it happens:**
JavaScript's `Date` has notoriously inconsistent timezone handling between `getDate()` (local) and `getUTCDate()` (UTC). Developers use both interchangeably, creating silent inconsistencies that only manifest at timezone boundary times (midnight to 8 AM in US timezones).

**How to avoid:**
- Pick one timezone representation and use it everywhere: UTC ISO strings for storage, local date for display. Never mix.
- Use a single utility function for "what is today's date" that all instrumentation code calls. That function makes the timezone decision once.
- For `daily-stats.md` row keys, use the user's configured local timezone date (e.g., `America/Los_Angeles`). Hard-code the timezone in config rather than relying on `process.env.TZ` or system locale.
- Add a test that simulates running at 23:59 local time and at 00:01 local time and verifies both attribute to the correct local date.

**Warning signs:**
- `daily-stats.md` rows appearing dated to the previous day when `/today` runs in the morning
- Inconsistency between the date on the briefing header and the date on the stats row
- Stats rows showing up 8–12 hours offset from expected (UTC vs. local timezone mismatch)

**Phase to address:** Phase 20 (Value Extraction Instrumentation).

---

### Pitfall 10: Metric Gaming — Counting Volume Instead of Value

**What goes wrong:**
The daily-stats dashboard shows "memories today: 5" and "total memories: 847." The user (Pete) optimizes for these numbers — promoting more memories per session, running `/promote-memories` more frequently, approving proposals faster — without asking whether the memories are high-quality and compound well.

A poorly worded memory promoted to hit a daily count provides false positive reinforcement. Over time, `memory.md` fills with low-signal entries ("Attended stand-up. No blockers.") that dilute retrieval quality. The `/recall` command returns these low-signal entries, making it feel less useful — which reduces trust in the system as a whole.

**Why it happens:**
Output metrics (count, growth rate) are easy to measure. Quality metrics (retrieval precision, entry usefulness over time) require human judgment or expensive LLM evaluation. The system naturally rewards what it can measure.

**How to avoid:**
- Instrument quality signals alongside volume signals from day one:
  - Track `/recall` invocations that return results rated "useful" by the user (requires a lightweight thumbs-up/down mechanism in `/recall` output, even if just a follow-up command)
  - Track Memory Echo entries that are clicked/expanded vs. skipped in `/today`
  - Track retrieval precision: did the top-ranked result actually answer the query? (Self-reported or inferred from follow-up behavior)
- Cap daily-stats display at useful signals: "memories that surfaced in /recall this week: 12" is more meaningful than "total memories: 847."
- Add a memory quality score to Phase 20 requirements rather than shipping pure volume metrics. Even a simple `is_compounding` boolean (manually set via `/promote-memories` approval) adds a quality dimension.
- Design the stats table schema to include quality fields upfront, even if they are empty at launch. Retrofitting quality metrics into an existing table format requires re-indexing and format migration.

**Warning signs:**
- Stats show growing count but `/recall` results feel less relevant over time
- Pete approving memory proposals without reading them (rubber-stamp behavior)
- `/recall` returning "attended stand-up" as a top result for substantive queries
- No quality dimension in the stats table schema

**Phase to address:** Phase 20 (Value Extraction Instrumentation) — the schema must include quality fields. Phase 18 (Memory Retrieval Foundation) — `/recall` output should include a feedback mechanism from the start.

---

### Pitfall 11: UAT Tests Calling Voyage API in CI — Cost and Key Leak

**What goes wrong:**
UAT tests verify end-to-end behavior including semantic recall. If these tests call the live Voyage API in CI (GitHub Actions), they: (a) require `VOYAGE_API_KEY` to be stored as a GitHub Actions secret, creating a credential exposure vector in the CI config; (b) incur real API cost on every test run and every PR; (c) flake when Voyage has transient rate limits or downtime; (d) make CI non-deterministic (embedding responses are stable but a model upgrade at Voyage would change similarity scores and break assertions).

This codebase already uses the `process.env.CI && test.skip` pattern for UAT tests that call the Anthropic API. The same guard must be applied to Voyage-dependent tests — but it is easy to miss when the Voyage dependency is buried in a retrieval utility, not an obvious "LLM call."

**Why it happens:**
Developers build the embedding integration and write tests against it without considering the CI context. The Voyage API feels "cheaper" than the Anthropic API so the cost concern is dismissed — but the determinism and key-leak concerns are equally serious regardless of cost.

**How to avoid:**
- Mock the Voyage API client in all unit and integration tests. Use a deterministic mock that returns a fixed embedding vector for known inputs. This makes tests fast, free, and deterministic.
- Isolate actual Voyage API calls to UAT-level tests with the existing `process.env.CI && test.skip` guard.
- Do NOT store `VOYAGE_API_KEY` as a GitHub Actions secret unless you have a specific CI use case that requires it (e.g., a nightly integration test run with a separate key). For PR testing, the mock is sufficient.
- If you do add `VOYAGE_API_KEY` to GitHub Actions secrets, use a separate API key scoped to a test account with a spending limit, not the primary production key.
- Add a deterministic embedding fixture: a pre-computed embedding for a known memory entry stored in the test fixtures directory. This allows retrieval tests to run without any API calls.

**Warning signs:**
- `VOYAGE_API_KEY` appearing in `.github/workflows/*.yml` as an environment variable
- Test suite making HTTP calls to `api.voyageai.com` in CI (detectable via network monitoring)
- CI failing on Voyage rate limit errors (HTTP 429 from voyage-ai.com)
- Non-deterministic test results for retrieval similarity assertions

**Phase to address:** Phase 17 (UAT CI Infrastructure) — the mock strategy and CI guard pattern must be established before any Voyage integration is written in Phase 19.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Re-embed full corpus on every run | Simple implementation, no cache management | Voyage API costs grow linearly with corpus size; eventual free-tier exhaustion | Never — content-hash cache should be day-one design |
| Eager index load at startup | Simple code | `/today` startup time grows with corpus size; cron cold-starts slow | Never — lazy load on first retrieval invocation |
| File-watcher-triggered re-index without debounce | Simple reactive design | Lock contention during batch promotion; feedback loop with dead-letter retry | Never — debounce is mandatory |
| Storing index inside vault directory | Co-location feels natural | Sync conflicts on multi-device; Obsidian Sync bandwidth bloat | Never — index is a derived artifact; store in project directory |
| Pure volume instrumentation (entry count only) | Easy to measure | Metric gaming; quality dilution of memory.md goes undetected | MVP only if quality fields are in the schema from day one |
| Calling live Voyage API in CI tests | Tests "real" integration | Key leak risk; cost accumulation; CI flakiness from rate limits | Never — mock in CI, UAT guard for live calls |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Voyage AI embedding API | Embedding query text without filtering excluded terms first | Apply the existing exclusion filter to query text before calling `voyage.embed()` |
| Voyage AI embedding API | Leaving data retention in default "Opted In" mode | Toggle to "Opted Out" in the Voyage dashboard as a Phase 19 prerequisite; document this as a required setup step |
| Voyage AI embedding API | Assuming the free tier (200M tokens/month) is inexhaustible | Implement per-run embedding budget and content-hash cache; monitor Voyage dashboard token consumption |
| Local vector index | Using HNSW for a sub-1000-entry corpus | Use a flat (brute-force) index; simpler, 100% recall, adequate performance below 10K entries |
| chokidar file watcher | Wiring re-index directly to `memory.md` change events | Debounce with a 2-second window; prefer triggering re-index as an explicit step inside `/promote-memories` |
| `daily-stats.md` | Using `new Date().toISOString()` for row keys without timezone alignment | Define a single timezone-aware date utility; use the user's configured local date for row keys |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Loading full vector index on every `/today` run | Cold-start delay grows weekly | Lazy load on first retrieval call; module-level singleton cache | Noticeable at ~500 entries; significant at ~5K |
| Re-embedding unchanged corpus entries | Voyage API call count equals corpus size per run | SHA-256 content hash per entry; only embed entries whose hash changed | Any scale; cost and latency issue from day one |
| Appending to `daily-stats.md` without idempotency | Multiple rows per day; unreliable Dataview queries | Check last-row date before append; update existing row if date matches | First day a retry fires during a stats append |
| Synchronous Voyage API call in `/recall` hot path | `/recall` blocks the entire briefing on Voyage latency | Implement timeout wrapper; fall back to keyword if Voyage exceeds 3 seconds | Every time Voyage has >3s response time |
| Scanning all of `memory.md` for keyword fallback | Linear scan slows as corpus grows | Maintain a separate keyword index (inverted term map) updated on entry promotion | Noticeable at ~2000 entries; significant at ~10K |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Sending excluded-term queries to Voyage API | Confidential content (ISPN/Genesys/Asana) transmitted to cloud provider | Apply exclusion filter to query text before embedding; fall back to keyword for excluded queries |
| Voyage account in default "Opted In" retention mode | Query text and document content used for Voyage model training | Opt out immediately on account creation; verify in dashboard; document as required setup |
| Storing VOYAGE_API_KEY in `.env` committed to git | API key leaked in repository history | Use `.env.local` (gitignored); verify `.gitignore` covers all `.env*` variants before Phase 19 starts |
| Storing VOYAGE_API_KEY as a GitHub Actions secret for PR CI | Broad secret exposure; cost accumulation if workflow is triggered by forks | Do not add to CI; use mock in tests; UAT guard for live calls |
| Index file storing raw memory text alongside vectors | Index becomes a secondary copy of memory content with weaker access controls | Store only IDs and hashes in the index; retrieve text from `memory.md` at query time |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| `/recall` showing similarity scores as raw cosine values (0.73, 0.61...) | Meaningless to non-technical user | Show ranked results with natural-language confidence labels ("highly relevant," "related") or no score at all |
| Memory Echo in `/today` showing 5 unrelated memories | Adds noise; Pete stops reading it | Limit to 3 results; apply a minimum similarity threshold (e.g., 0.6 cosine); if no results above threshold, omit the section rather than showing low-relevance noise |
| `/recall` with no results returning an error | Confusing failure mode | Return "No memories found for this query" with a suggestion to try different keywords |
| Stats dashboard showing only current-day metrics | No sense of trend or compounding | Show 7-day and 30-day rolling averages alongside daily count |
| Metric count dominating the stats view | Optimizes for volume over quality | Lead with a quality signal (e.g., "memories recalled this week") before showing raw count |

## "Looks Done But Isn't" Checklist

- [ ] **Content-hash cache:** Verify that running `/today` twice in a row results in zero new Voyage API calls on the second run (all entries already cached)
- [ ] **Schema version check:** Change a memory.md entry format field; verify the index startup detects the mismatch and re-embeds before serving results
- [ ] **Voyage offline fallback:** Unset `VOYAGE_API_KEY`; run `/recall`; verify it falls back to keyword search and does not crash `/today`
- [ ] **Query exclusion filter:** Run `/recall ISPN contract`; verify the excluded term is stripped or the query falls back to keyword before the Voyage API is called
- [ ] **Voyage data retention opt-out:** Log into the Voyage dashboard and confirm the "Opted Out" slider is in the correct position
- [ ] **Index outside vault:** Confirm `.index/` is stored in `~/projects/second-brain/` (or similar), not inside `~/Claude Cowork/`
- [ ] **daily-stats.md idempotency:** Run `/today` three times on the same day; verify `daily-stats.md` has exactly one row for that date
- [ ] **Timezone consistency:** Run the date utility function with a simulated 23:59 local time; verify the row date matches the local date, not UTC date
- [ ] **CI mock:** Verify that running `npm test` with no `VOYAGE_API_KEY` set completes successfully (all Voyage calls are mocked)
- [ ] **Index rebuild:** Delete `.index/`; run `/recall`; verify the index is rebuilt from `memory.md` and results are returned correctly

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Stale embeddings from schema change | LOW | Delete `.index/`; rebuild index (all entries re-embedded in one batch); schema_version updated in metadata |
| Index sync conflict (iCloud duplicate) | LOW | Delete the conflict copy; move `.index/` to the project directory (outside vault sync path); rebuild |
| Voyage API free tier exhausted | LOW | Upgrade to paid tier or pause embedding; keyword fallback continues to work; no user-visible feature loss |
| Metric gaming: low-quality entries in memory.md | MEDIUM | Manual audit of memory.md entries; add quality tags; re-promote high-signal entries; no automated recovery |
| VOYAGE_API_KEY leaked in git history | HIGH | Rotate key immediately in Voyage dashboard; use `git filter-repo` to scrub history; audit for unauthorized API usage |
| Re-index feedback loop (dead-letter + file watcher) | MEDIUM | Stop the Node.js process; delete `.index/.lock` if present; apply debounce fix; restart; verify loop is broken by checking log timestamps |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Embedding drift from schema change | Phase 19 | Change a memory entry format; verify schema_version mismatch triggers re-embed |
| Index bloat / eager load | Phase 19 | Profile `/today` cold-start time at 500 entries; must be under 5 seconds |
| Cost runaway via re-embed | Phase 19 | Run `/today` twice; verify Voyage API call count equals only new/changed entries |
| Re-index thrash / lock contention | Phase 19 | Run `/promote-memories` with 5 entries; verify exactly one re-index pass fires |
| Voyage offline graceful degradation | Phase 19 | Unset API key; run `/recall`; verify keyword fallback and no briefing crash |
| Query embedding privacy | Phase 19 | Run `/recall ISPN test`; verify no HTTP call to api.voyageai.com for excluded queries |
| Index sync conflicts | Phase 19 | Confirm index path is outside vault directory before writing first entry |
| daily-stats.md idempotency | Phase 20 | Run `/today` three times; verify one row per date |
| Timezone boundary bugs | Phase 20 | Unit test date utility at 23:59 and 00:01 in user's local timezone |
| Metric gaming | Phase 20 | Stats table schema includes quality field from initial commit |
| UAT CI key leak / cost | Phase 17 | CI passes with no VOYAGE_API_KEY set; all Voyage calls use mock |

## Sources

### Primary (HIGH confidence)
- Voyage AI official docs (docs.voyageai.com/docs/pricing, docs.voyageai.com/docs/faq) — pricing tiers, data retention opt-out procedure, zero-day retention policy
- Weaviate blog "When Good Models Go Bad" — embedding model mismatch failure modes
- ChromaDB FAQ (cookbook.chromadb.dev) — schema version incompatibility patterns
- Pinecone/Faiss vector index guides — HNSW memory calculation: (d * 4 + M * 2 * 4) bytes per vector
- Tonic.ai / IronCore Labs research — 40% PII recovery from sentence-level embeddings

### Secondary (MEDIUM confidence)
- Obsidian Smart Connections GitHub issues — offline fallback, BM25 fallback pattern in Obsidian QMD plugin
- Obsidian Forum sync conflict discussions — iCloud duplicate file behavior with binary/large files
- Voyage AI pricing comparison (awesomeagents.ai, tokenmix.ai) — voyage-4 shared embedding space design, batch API 33% discount
- RAGFlow 2025 year-end review — persistent compounding wiki vs. re-derive-on-query tradeoff

### Tertiary (LOW confidence — flag for validation)
- Zilliz blog (faiss vs hnswlib) — performance benchmarks; validate against actual corpus size before choosing index type
- DevTo distributed locks in Node.js — lock contention patterns; implementation must be tested against actual chokidar behavior in this codebase

---
*Pitfalls research for: Voyage AI embeddings + vector search + instrumentation (v1.4 additions to second-brain vault)*
*Researched: 2026-04-24*
