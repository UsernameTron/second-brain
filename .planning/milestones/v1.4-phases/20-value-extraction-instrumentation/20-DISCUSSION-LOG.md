# Phase 20: Value Extraction Instrumentation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `20-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-24
**Phase:** 20 — Value Extraction Instrumentation
**Areas discussed:** File layout & rotation, avg_confidence, recall_count, Briefing summary content, RRF telemetry deferral, Discretion items

---

## File Layout & Rotation

### Question 1: Where should `daily-stats.md` live in the vault?

| Option | Description | Selected |
|--------|-------------|----------|
| `RIGHT/daily-stats.md` (per REQ) | Documented baseline from REQUIREMENTS.md STATS-DAILY-01. At RIGHT/ root, alongside standup-2026-04-24.md, second-brain-finishing-playbook.md. | ✓ |
| `RIGHT/metrics/daily-stats.md` | Subfolder for the metrics class of files. Future-proofs if Phase 20 needs more stats files. | |
| `RIGHT/metrics/2026/daily-stats.md` | Year-bucketed. Keeps individual files small once the table is multi-year. | |

**User's choice:** `RIGHT/daily-stats.md` (per REQ).

**Notes:** Operator initially suggested `RIGHT/metrics/daily-stats.md` as an offhand read in a different chat context, but on review made clear: *"My 'RIGHT/metrics/ makes more sense' comment was a casual read, not a locked architectural decision. I hadn't reviewed REQUIREMENTS.md when I said it. If the ROADMAP spec says RIGHT/daily-stats.md, that's the documented decision and Claude Code shouldn't override it based on an offhand remark from a different context window."* Decision unlocked and discussed properly. Lesson captured in `tasks/lessons.md`.

### Question 2: How should the table itself be formatted?

| Option | Description | Selected |
|--------|-------------|----------|
| Markdown table (single, append-only) | Standard pipe-separated GFM table. Renders cleanly in Obsidian. | |
| Markdown table + YAML frontmatter | Add frontmatter block with schema_version, columns array, last_updated. Lets the writer detect/migrate format changes without breaking existing rows. | ✓ |
| Dataview-friendly (block per day) | Each day = a heading + key:value lines, queryable by Obsidian Dataview. | |

**User's choice:** Markdown table + YAML frontmatter.

**Notes:** Frontmatter gives versioning + atomic-write metadata for free. `gray-matter` is already a project dep.

---

## avg_confidence Column

### Question 1: What does `avg_confidence` measure?

| Option | Description | Selected |
|--------|-------------|----------|
| Promotion classifier confidence | Avg confidence score from memory-extractor across today's promoted entries. | ✓ |
| Top semantic match score | Avg of the top-1 cosine score across today's /recall --semantic and --hybrid invocations. | |
| Hybrid RRF top score | Avg of top-1 RRF score across today's /recall --hybrid invocations only. | |
| Retrieval confidence (top-k mean) | Avg of top-k score (k=5) across all semantic + hybrid recalls. | |

**User's choice:** Promotion classifier confidence.

### Question 2: Which question should daily stats answer about confidence?

| Option | Description | Selected |
|--------|-------------|----------|
| 'Quality of inputs' | Are the memories getting promoted actually good ones? Maps to promotion classifier confidence. | ✓ |
| 'Quality of retrieval' | When I search, are the top hits strongly relevant? | |
| Both — split into two columns | Add a column. Track input quality AND retrieval quality separately. | |

**User's choice:** 'Quality of inputs'.

**Notes:** Cleanly aligns with the v1.4 thesis (memory compounds when inputs are high-quality). Retrieval quality is meaningful but already implicitly captured via Phase 19's threshold gating.

---

## recall_count Semantics

### Question 1: What does `recall_count` count?

| Option | Description | Selected |
|--------|-------------|----------|
| /recall invocations | Number of times you ran /recall today (any mode — keyword, semantic, hybrid). | ✓ |
| Entries returned (sum) | Total memory entries surfaced across all recalls. | |
| Hits above threshold | Only counts results that passed the threshold. | |
| /recall sessions (deduped by query) | Distinct queries run today. | |

**User's choice:** /recall invocations.

### Question 2: Should `/today` Memory Echo invocations count toward `recall_count`?

| Option | Description | Selected |
|--------|-------------|----------|
| No — only explicit /recall | Memory Echo runs automatically every morning regardless. Counting it floods the metric with one daily auto-hit. | ✓ |
| Yes — count both | Echo IS a recall, just an automatic one. | |
| Track both, separate columns | recall_count for explicit, echo_count for automatic. | |

**User's choice:** No — only explicit /recall.

**Notes:** recall_count tracks intentional engagement with the memory layer, not automatic surface area.

---

## Briefing Summary Content (TODAY-SUMMARY-01)

### Question 1: Which deltas appear in the "Yesterday: ..." one-liner?

| Option | Description | Selected |
|--------|-------------|----------|
| REQ example: proposals + promotions + KB | Three deltas. Matches the spec verbatim. Doesn't include retrieval activity. | |
| Add recall_count + total_entries | Five-tuple. Includes whether you actually used the memory yesterday. Tells the compounding story end-to-end. | ✓ |
| Memory growth only | "Yesterday: +1.4 KB memory (+2 entries)". Simplest. | |
| Smart — omit zero-delta fields | Show only fields that changed yesterday. | |

**User's choice:** Add recall_count + total_entries (5-tuple).

### Question 2: When should the summary line be suppressed?

| Option | Description | Selected |
|--------|-------------|----------|
| Only on first run ever (per REQ) | Suppress only when no prior-day row exists. Otherwise always show. | ✓ |
| Suppress on zero-activity days | If yesterday had 0 proposals, 0 promotions, 0 KB growth, AND 0 recalls — omit. | |
| Suppress on weekends/holidays | Skip Sat/Sun/holiday rows. | |
| Suppress when stats file is broken/missing | If daily-stats.md is unreadable/corrupt, skip the line silently. | ✓ |

**User's choice:** Options 1 + 4 together.

**Notes:** Operator's framing — *"Always show the line (zero-activity days are informative, not shameful — they tell you the system ran but nothing happened). But if the stats file is missing or corrupt, skip silently rather than breaking the briefing. The briefing is the product; the stats summary is a nice-to-have inside it."* Captured as a project tenet (D-06 governing principle: stats failure must never block /today).

---

## RRF Telemetry Deferral

### Question: Phase 19 deferred RRF telemetry here. Fold it in or defer further?

| Option | Description | Selected |
|--------|-------------|----------|
| Fold in: 2 extra columns | Add avg_top_semantic and avg_top_rrf columns. | |
| Defer further (Phase 21 or v1.5) | Ship Phase 20 with just the 4 REQs as written. Capture the raw data emit point for later wiring. | ✓ |

**User's choice:** Defer further.

**Notes:** Operator's framing — *"You just spent this whole discussion keeping the stats row tight and putting retrieval quality metrics in the 'fusion telemetry' bucket. Adding two retrieval columns now contradicts every decision you just locked. Ship the 4 REQs clean, wire the emit point so the data is available, and let Phase 21 or v1.5 build the telemetry dashboard properly."* Internal consistency check that caught a near-contradiction in real time.

---

## Discretion Items (locked without further discussion)

| Item | Decision |
|------|----------|
| Timezone library | Native `Intl.DateTimeFormat({timeZone: 'America/Chicago'})` — zero deps |
| Idempotency strategy | Atomic `.tmp` rename rewrite (mirror voyage-health.js Pattern 7) |
| Same-day re-run behavior | Last-run-wins (full row replaced, not running-averaged) |
| Voyage-degraded latency fields | Render `null` / `—`, never break the row |
| Memory size sampling time | End of /today run (post-everything snapshot) |
| Module loading | `src/daily-stats.js` lazy-required from today-command.js (Pattern 12) |

**User's choice:** All five (six) discretion items accepted.

**Notes:** Operator caught a critical timezone error in the same response — *"The timezone choice is the only one worth noting — you're in Central (Fort Worth), not Pacific. Make sure that's America/Chicago, not America/Los_Angeles."* This triggered REQ-AMEND-01: REQUIREMENTS.md STATS-GROWTH-01's `America/Los_Angeles` is corrected to `America/Chicago` in the same commit as this CONTEXT.md.

---

## Claude's Discretion (post-discussion)

Items where Claude has flexibility within the locked decisions:

- Internal layout of `src/daily-stats.js` (single file vs `src/stats/` directory — pick whichever stays under 300 LOC)
- Counter accumulation mechanism for `recall_count` / proposals / promotions (read-modify-write the day's row directly, vs tiny per-day counter files in `~/.cache/`) — pick simpler
- Test fixture organization (mirror Phase 19's nock-based mocks for any external calls)
- JSDoc style (inherit from `voyage-health.js` and `memory-reader.js`)
- Where the summary-line prepend lives (`briefing-renderer.js` vs `briefing-helpers.js`)
- Exact storage shape for deferred RRF emit data (append-only line per call, JSONL or markdown — pick whichever Phase 21 will find easier to consume)

## Deferred Ideas

Captured in `20-CONTEXT.md` `<deferred>` section:

- RRF fusion telemetry columns → Phase 21 or v1.5
- Year-bucketed file rotation → revisit when multi-year
- `RIGHT/metrics/` subfolder convention → revisit at 3+ metrics files
- Dataview-friendly per-day blocks → if Obsidian Dataview integration becomes a goal
- Median/p75 latency stats → if mean proves spike-sensitive
- Echo invocations as separate `echo_count` column → if Echo signal becomes interesting

---

*End of Discussion Log.*
