# Phase 20: Value Extraction Instrumentation - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 20 delivers daily measurable evidence that memory compounds. Two artifacts:

1. `~/Claude Cowork/RIGHT/daily-stats.md` — one row per calendar day with 8 columns (`date | proposals | promotions | total_entries | memory_kb | recall_count | avg_latency_ms | avg_confidence`). Idempotent same-day rewrites.
2. A one-line "Yesterday: ..." summary at the top of `/today` briefings, computed from the prior day's row.

Builds on Phase 18 (`getMemoryEcho`, `readMemory`), Phase 19 (`semantic-index.js`, `voyage-health.js`), and Phase 15 (today-command 230-LOC orchestrator with extracted modules in `src/today/`). Adds one new module (`src/daily-stats.js`), one new orchestrator step in `today-command.js`, one summary-line render at the briefing top, and emit-point hooks at the `/recall`, `/promote-memories`, and `semantic-index` boundaries.

**Out of phase:** RRF fusion telemetry surface (deferred from Phase 19, deferred again here — wire emit point only). New retrieval columns. Year-bucketed file rotation. Median/p75 latency math. Memory Echo invocations counted toward `recall_count`. Any change to `/new` behavior.

</domain>

<decisions>
## Implementation Decisions

### Pre-Locked (REQUIREMENTS.md / Phase 19 / KB v2.1 patterns — not re-opened in discussion)

- **D-PRE-01:** The 4 REQs as-written are the scope: STATS-DAILY-01, STATS-LATENCY-01, STATS-GROWTH-01, TODAY-SUMMARY-01.
- **D-PRE-02:** Per Phase 19's `19-CONTEXT.md` "Deferred to Phase 20" item, raw RRF rank data should be **available** at the emit-point level (semantic-index, recall-command) for downstream telemetry — but **not surfaced** in this phase's stats columns. Phase 21 or v1.5 builds the dashboard.
- **D-PRE-03:** Active KB v2.1 patterns from `state/pattern-context.md` carry into this phase:
  - **Pattern 7** (Adaptive Denial Tracking) — daily-stats writes use the same atomic `.tmp` rename idiom as `voyage-health.js`.
  - **Pattern 11** (Feature Flags as Security Perimeters) — daily-stats writes go through `vault-gateway.js` like every other RIGHT-side write; LEFT/RIGHT boundary is enforced in code, not config.
  - **Pattern 12** (Lazy Prompt Loading) — `src/daily-stats.js` is `require()`'d lazily from `today-command.js`, never at module top.

### Locked in Discussion

- **D-01:** File location = `~/Claude Cowork/RIGHT/daily-stats.md` per REQ STATS-DAILY-01 baseline. No `metrics/` subfolder. (User initially suggested `RIGHT/metrics/daily-stats.md` as an offhand read, then unlocked it in discussion to follow the documented spec.)
- **D-02:** File format = markdown pipe-table with YAML frontmatter:
  - Frontmatter keys: `schema_version` (int), `columns` (array of strings, source of truth for column order), `last_updated` (ISO 8601 UTC), `timezone` (string, e.g. `America/Chicago`)
  - Body: standard GFM pipe table, one row per calendar day, ordered ascending by date.
- **D-03:** `avg_confidence` semantics = **mean of memory-extractor classifier confidence** across today's promoted entries. Signal carried = "quality of inputs" (are we promoting good memories?). Not retrieval confidence.
- **D-04:** `recall_count` semantics = **count of explicit `/recall` invocations** today (any mode — `--keyword`, `--semantic`, `--hybrid`). **Memory Echo's automatic morning hit is NOT counted.** Signal carried = "intentional use of the memory layer."
- **D-05:** Briefing summary deltas = **5-tuple**: `proposals`, `promotions`, `memory_kb`, `total_entries`, `recall_count`. Wording (verbatim):
  > `"Yesterday: +N proposals, +M promotions, +X.X KB memory, +K entries, R recalls"`
  Numbers always render with sign (`+0` allowed; `-N` allowed for entries-removed cases).
- **D-06:** Summary suppression rules:
  - Always show on day 2+ (zero-activity days are signal, not shame — they tell you the system ran but nothing happened).
  - Suppress **silently** if stats file is missing, unparseable, or has no prior-day row.
  - **Governing principle (carried as project tenet):** *Briefing is the product; stats is a nice-to-have inside it.* Stats failure must never raise, never block, never break briefing formatting. All daily-stats calls in `today-command.js` wrapped in try/catch with logged-but-not-surfaced warnings.
- **D-07:** RRF/cosine telemetry = **deferred to Phase 21 or v1.5**. In this phase, wire emit points in `semantic-index.js` (top-1 cosine score per call) and `recall-command.js` (top-1 RRF score for `--hybrid` calls) so the data is available when the dashboard work happens. Do NOT surface in `daily-stats.md` columns. Two extra columns (`avg_top_semantic`, `avg_top_rrf`) were considered and rejected as scope creep against D-01/D-02's "tight stats row" intent.
- **D-08:** Timezone = **`America/Chicago`** (operator is in Fort Worth, Central time).
  - **REQ-AMEND-01 required:** REQUIREMENTS.md STATS-GROWTH-01 currently specifies `America/Los_Angeles`. That's a REQ bug from initial drafting and must be corrected to `America/Chicago` in the same commit as this CONTEXT.md.
  - Boundary unit tests for `dateKey()` run at 23:59 + 00:01 Central per the corrected REQ.

### Claude's Discretion

Claude may decide without further user input (locked as discretion in discussion):

- **Timezone library** = native `Intl.DateTimeFormat({timeZone: 'America/Chicago'})`. Zero deps. Sufficient for `dateKey()` (YYYY-MM-DD per Central) and the 23:59/00:01 boundary tests.
- **Idempotency strategy** = atomic `.tmp` rename rewrite of the entire file (mirror `src/utils/voyage-health.js` Pattern 7 idiom). Read → mutate in memory → write `daily-stats.md.tmp` → `rename()` to `daily-stats.md`. Never partial writes.
- **Same-day re-run behavior** = last-run-wins. The full row for today's `dateKey()` is replaced, not running-averaged. Simplest, freshest data; matches REQ "updates the existing row rather than appending a duplicate."
- **Voyage-degraded latency fields** = render `null` / `—`. Don't break the row; don't fabricate numbers. Phase 19's `voyage-health.json` is the source of truth for whether semantic was attempted.
- **Memory size sampling time** = end of `/today` run (post-everything snapshot). `memory_kb` = `fs.statSync(memoryPath).size / 1024`, rounded to 1 decimal.
- **Module loading** = `src/daily-stats.js` is lazy-required from `today-command.js` (`const { recordDailyStats } = require('./daily-stats')` inside the orchestrator step, not at module top). Pattern 12.
- **JSDoc style** = inherit from `voyage-health.js` and `memory-reader.js` shape (file-level + function-level @param/@returns).
- **Test fixture organization** = mirror Phase 19 patterns (`test/daily-stats.test.js` for unit, `test/integration-today-stats.test.js` for /today end-to-end, UAT-guarded if it touches the live vault).

### Folded Todos

None — `gsd-tools todo match-phase 20` returned 0 matches.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` §"Value Extraction Instrumentation (Phase 20)" — the 4 REQs (STATS-DAILY-01, STATS-LATENCY-01, STATS-GROWTH-01, TODAY-SUMMARY-01) **after REQ-AMEND-01 lands** (TZ correction `America/Los_Angeles` → `America/Chicago`)
- `.planning/REQUIREMENTS.md` §"Out of Scope" — explicit exclusions still binding (no `/new` changes, no real-time embedding, no vault-side embedding storage)
- `.planning/ROADMAP.md` §"Phase 20: Value Extraction Instrumentation" — success criteria (4 items, all must be TRUE)
- `.planning/STATE.md` §"Milestone v1.4 Locked Decisions" — keyword + semantic ship; `/new` untouched

### Prior Phase Context (build-on-top)
- `.planning/phases/19-semantic-memory-search/19-CONTEXT.md` §"Deferred to Phase 20" — RRF rank emit hand-off
- `.planning/phases/19-semantic-memory-search/19-CONTEXT.md` §"Implementation Decisions" — D-09 voyage-health failure tracking, D-11 config schema convention
- `.planning/phases/18-memory-retrieval-foundation/18-CONTEXT.md` — Memory Echo path; `getMemoryEcho()` shape
- `.planning/phases/15-architecture-decomposition/*` (if present) — today-command orchestrator pattern (230-LOC orchestrator + extracted modules)

### Project Principles
- `/Users/cpconnor/projects/second-brain/CLAUDE.md` — LEFT/RIGHT boundary, no ISPN/Genesys/Asana, briefing-is-the-product corollary
- `state/pattern-context.md` — P7/P11/P12 active patterns and their Phase 20 applications
- `tasks/lessons.md` — including 2026-04-24 cache-invalidation lesson (relevant: don't add columns/work for telemetry that isn't actually wanted yet — applies to D-07's defer-not-surface choice) and the offhand-comment lesson added in this same commit

### Source Code (integration points)
- `src/today-command.js` — Phase 15 orchestrator. Add `recordStats` step after `briefing-renderer` invocation; add summary-line prepend at top of briefing.
- `src/today/` — extracted modules (slippage-scanner.js, frog-identifier.js, llm-augmentation.js, briefing-renderer.js)
- `src/promote-memories.js` — proposals (`memory-proposals.md` row count) and promotions (entries appended to memory.md) emit points
- `src/memory-extractor.js` — classifier confidence on each proposal; aggregate at promotion time
- `src/recall-command.js` — `recall_count` increment point; RRF top-1 emit point for `--hybrid`
- `src/semantic-index.js` — cosine top-1 emit point for `--semantic`
- `src/utils/voyage-health.js` — atomic write template (`.tmp` rename) and Pattern 7 reference
- `src/vault-gateway.js` — RIGHT-side write enforcement; daily-stats.md path goes through it
- `src/pipeline-infra.js` — `loadConfigWithOverlay()` for new `stats.*` config block
- `src/memory-reader.js` — `### ` header counting for `total_entries`; `readMemory()` shape
- `src/briefing-helpers.js` — briefing render utilities; summary-line prepend likely lives here

### Schemas to extend
- `config/schema/pipeline.schema.json` — add `stats` sub-object:
  - `enabled` (boolean, default true)
  - `path` (string, default `~/Claude Cowork/RIGHT/daily-stats.md` or relative-to-vault equivalent)
  - `timezone` (string, default `America/Chicago`)
  - `summaryLineEnabled` (boolean, default true)
  - `schemaVersion` (int, default 1)
  - All optional with defaults; backward-compatible additive change

### External (no fetch needed for this phase)
- None. All required APIs (Voyage, Anthropic) already wrapped in existing modules.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/today-command.js` orchestrator pattern** (Phase 15): the 230-LOC version is a clean Pipeline of named steps. Adding `recordStats` after `briefing-renderer` is one new line + one lazy require. The summary-line prepend can live in `briefing-renderer.js` or `briefing-helpers.js` (Claude's discretion).
- **`src/utils/voyage-health.js` atomic write helper**: copy the `.tmp` rename idiom into the daily-stats writer. Same shape: read → mutate in memory → write tmp → rename. Same chmod 0600 if the writer wants matching permissions (less critical here since the file is in the vault, not `~/.cache`).
- **`src/vault-gateway.js`**: RIGHT-side write check. The path `~/Claude Cowork/RIGHT/daily-stats.md` flows through it like any other RIGHT-side write — no new exception code.
- **`src/pipeline-infra.js` `loadConfigWithOverlay()`**: AJV-validated config + `pipeline.local.json` overlay. The new `stats.*` block plugs straight in alongside `memory.semantic.*` (Phase 19's block).
- **`src/memory-reader.js` header parser**: source of truth for `### `-prefixed entry headers in `memory.md`. Reuse for `total_entries`; do not reimplement.
- **`gray-matter@^4.0.x`** (already in deps): for parsing/writing the YAML frontmatter on `daily-stats.md`. No new dep needed.

### Established Patterns
- **Config overlay + AJV schema validation** — every tunable goes through `loadConfigWithOverlay('pipeline', {validate: true})`. No hardcoded constants outside `src/daily-stats.js` defaults that mirror schema defaults.
- **`/new`-untouched discipline** — Phase 20 must not add a dependency from `new-command.js` to `daily-stats.js`. Stats counters (`recall_count`, etc.) are accumulated via emit points in their respective command modules and read at row-render time.
- **Briefing-is-the-product corollary** — every daily-stats call in `today-command.js` is wrapped in try/catch. Failure logs at debug level, never breaks briefing render.
- **Pattern 7 atomic writes** — voyage-health.js's `.tmp` rename idiom is the reference. Daily-stats writer mirrors it byte-for-byte except for the file path.
- **Pattern 12 lazy require** — daily-stats lives behind `today-command`'s lazy require. Keyword-only `/today` (Voyage degraded) still records stats; the lazy require has no Voyage cost.

### Integration Points
- **`/today` orchestrator step**: `recordDailyStats({proposals, promotions, totalEntries, memoryKb, recallCount, avgLatencyMs, avgConfidence})` called after briefing render with the day's tallies. Wraps in try/catch.
- **`/today` summary-line prepend**: read prior day's row from `daily-stats.md`, format the 5-delta line, prepend to briefing output. Empty string returned if no prior row or file unparseable.
- **`/recall` recall_count increment**: each invocation of `runRecall()` increments a per-day counter. Storage = same `daily-stats.md` (read-modify-write the current day's row) OR a tiny per-day counter file (`~/.cache/second-brain/recall-count-YYYY-MM-DD`). Discretion choice — pick whichever stays simple.
- **`/promote-memories` proposals/promotions counts**: emit at promotion success. Same storage decision as recall_count.
- **`semantic-index.js` cosine emit / `recall-command.js` RRF emit**: write top-1 score to a per-call record (deferred from being summarized — Phase 21 reads these). Storage = append-only line per call, easy to grep.
- **`config/pipeline.json` extension**: `stats.*` block alongside `memory.semantic.*` and `memory.echo.*`. Schema-validated. Local overlay for dev.

### Caveats / Pitfalls
- **Counter accumulation across processes**: `/today`, `/recall`, and `/promote-memories` are separate process invocations. The simplest accumulator is "read the day's row, increment the relevant column, write back atomically." Lock contention is unlikely (operator runs these manually, not concurrently).
- **First-day boundary**: day 1 has no prior row to summarize from — D-06 says suppress silently. `total_entries` and `memory_kb` snapshot day 1 just establishes the baseline.
- **Vault-relative vs absolute path**: vault-gateway expects vault-relative paths. `daily-stats.md` lives at vault-root-relative `RIGHT/daily-stats.md`. Stats config stores the relative path; absolute path resolved via `VAULT_ROOT` (Phase 19 convention).

</code_context>

<specifics>
## Specific Ideas

- **Briefing-is-the-product principle** (operator-stated, governing): "Stats summary is a nice-to-have inside the briefing. Stats failure must never break the briefing." Every daily-stats call in `/today` is non-fatal.
- **Timezone correction**: operator is in Fort Worth (Central, `America/Chicago`). REQUIREMENTS.md STATS-GROWTH-01 incorrectly specifies `America/Los_Angeles`. This is a same-conversation discovery during Phase 20 discussion and is amended in REQ-AMEND-01.
- **5-delta summary line, exact wording**:
  `"Yesterday: +N proposals, +M promotions, +X.X KB memory, +K entries, R recalls"`
  - Numbers always render with sign on first 4 deltas; `recall_count` is a count, no sign.
  - Memory size to 1 decimal place.
  - Comma-separated, no Oxford comma (matches operator's existing prose style).
- **Stats failure semantics**: log at debug level (already the project convention via `console.debug` or no-console-mode equivalent), never `console.error` or `console.warn` — those tracked by hygiene work and would create false-positive noise.

</specifics>

<deferred>
## Deferred Ideas

### Deferred to Phase 21 or v1.5
- **RRF fusion telemetry** as 2 extra columns (`avg_top_semantic`, `avg_top_rrf`) in `daily-stats.md`. D-07 wires the emit point; the dashboard surface waits.
- **Year-bucketed file rotation** (`RIGHT/metrics/2026/daily-stats.md`). Revisit when the table grows multi-year and a single file is unwieldy.
- **`RIGHT/metrics/` subfolder convention**. Revisit when there are 3+ metrics-class files (`daily-stats.md`, `weekly-rollup.md`, `latency-detail.md`, etc.) and a folder makes navigation cleaner.
- **Dataview-friendly per-day blocks**. Pursue if Obsidian Dataview integration becomes a goal for the dashboard work.
- **Median/p75 latency stats**. Pursue if mean proves spike-sensitive in production use.
- **Echo invocations as separate `echo_count` column**. Revisit if Memory Echo's signal becomes interesting to track separately from explicit `/recall`.

### Reviewed Todos (not folded)
None — `gsd-tools todo match-phase 20` returned 0 matches; no todos were considered for inclusion.

</deferred>

---

*Phase: 20-value-extraction-instrumentation*
*Context gathered: 2026-04-24*
