# Phase 2: Content Pipeline - Discussion Log

**Date:** 2026-04-22
**Session:** 8
**Mode:** discuss (interactive)
**Gray areas explored:** 10 (4 initial + 6 user-requested)

## Gray Areas Presented

### Initial Set (4)

1. **Input Classification** — How /new classifies input into LEFT/RIGHT and subdirectory
2. **Left/Right Routing** — How LEFT-classified content is handled without violating write boundary
3. **Memory Extraction** — What gets extracted, when, from what sources
4. **Memory Promotion** — How proposals move from staging to memory.md

User selected: All 4.

### Extended Set (6, user-requested)

After initial 4, user requested additional exploration ranked by blast radius:

5. **P1: Error Handling** — Dead-letter pattern, failure taxonomy, auto-retry
6. **P2: Session Transcript** — How /wrap reads and extracts from transcripts
7. **P3: Config Layout** — New config files, schema validation, hot-reload fix
8. **P4: Pipeline Composition** — Stage ordering, correlation IDs, phase boundaries
9. **P5: Carryover Items** — Hot-reload defect and excluded-terms expansion ownership
10. **P6: Scope Boundaries** — Explicit in-scope deliverables and out-of-scope items

## Discussion Summary

### Input Classification (D-01 through D-06)

**Q:** Single-label flat classifier or hierarchical approach? How many domains?
**A (custom):** Hierarchical two-stage. Stage 1 = voice gate (LEFT/RIGHT binary). Stage 2 = subdirectory pick (4-9 labels depending on side). Rejected flat classifier (13+ labels too noisy), abstract categories (adds layer without value), and personal-work split (orthogonal to the actual rule which is voice authenticity).

**Q:** Which LLM for classification? Confidence fallback strategy?
**A (custom):** Haiku primary for both stages. Sonnet escalation when Stage 2 Haiku < 0.8. Specific thresholds: Stage 1 < 0.8 = user confirm, Stage 2 < 0.7 = user pick top 2. Cost estimate: ~$0.002/classification for Haiku-only, ~$0.006 with Sonnet escalation.

**Q:** Note format and filename conventions?
**A (custom):** Base YAML frontmatter for all notes. Template overlays for exactly 3 domains (briefings, job-hunt, interview-prep). Haiku-powered field extraction for templates. Filename convention with 60-char cutoff.

### Left/Right Routing (D-12 through D-16)

**Q:** How to handle LEFT-classified content?
**A (custom):** proposals/left-proposals/ with detailed proposal format. Status lifecycle: pending → accepted/rejected/rerouted. 14-day auto-archive. Review surface is Obsidian (Dataview filter on status: pending). /promote-left deferred to v1.1.

### Wikilink Suggestions (D-17 through D-20)

**Q:** How to suggest wikilinks for new notes?
**A (custom):** Hybrid filename-search + Haiku re-rank pipeline. Cached vault index at .cache/vault-index.json. Four-step process: tokenize → grep index → Haiku re-rank (>= 0.6) → append 3-5 links. RIGHT notes link freely; LEFT proposals include suggestions inside proposal body.

### Memory Extraction (D-21 through D-27)

**Q:** What triggers extraction? What categories?
**A (custom):** Three triggers (wrap hook, on-demand, daily sweep). Seven categories (DECISION, LEARNING, PREFERENCE, RELATIONSHIP, CONSTRAINT, PATTERN, OTHER). Confidence gate: >= 0.75 standard, 0.5-0.75 low-confidence, < 0.5 drop. Dedup via source-ref + content-hash.

### Memory Promotion (D-28 through D-34)

**Q:** How is memory.md structured? What's the review/promotion flow?
**A (custom):** Single file, month-level sections, inline Dataview fields. Obsidian review + CLI executor pattern. Batch cap of 10. Content-hash dedup on promotion. Archive at 200KB/500 entries.

### Error Handling (D-35 through D-39)

**Q (user-initiated):** What happens when pipeline stages fail?
**A (custom):** Dead-letter to proposals/unrouted/ with failure-mode taxonomy (api-error, timeout, parse-error, confidence-floor, gate-rejection). Auto-retry for safe modes only (api-error, timeout). Cap at 3 attempts. Input preservation is non-negotiable. Enrichment failures never block primary write.

### Session Transcript (D-44 through D-46)

**Q (user-initiated):** How does /wrap access and process session transcripts?
**A (custom):** Hook stdin provides transcript_path (JSONL). Stream line-by-line. Corpus rules: include user messages + assistant text + semantically-weighted tool outputs. Exclude system messages, empty/short, Read/Glob/Grep pairs. Chunked extraction for oversized transcripts.

### Config Layout (D-47 through D-50)

**Q (user-initiated):** How should Phase 2 config files be organized?
**A (custom):** New files: pipeline.json, templates.json, schema/*.schema.json. Phase 2 owns hot-reload fix (chokidar-based, prerequisite task) and excluded-terms expansion (Pete-owned list). All thresholds in pipeline.json, never hardcoded.

### Pipeline Composition (D-40 through D-43)

**Q (user-initiated):** What's the stage ordering and how do stages communicate?
**A (custom):** Sequential Stage 0-5. Stage 0 (exclusion) fails closed. Correlation IDs (UUID per /new) thread through all stages. Phase boundary: content-policy.js consumed, not modified. Shared infrastructure: Haiku client, JSON parser, logger, dead-letter writer.

### Scope Boundaries (in-scope/deferred)

**Q (user-initiated):** What exactly is in scope for Phase 2?
**A (custom):** 5 new commands (/new, /extract-memories, /promote-memories, /reroute, /promote-unrouted), 2 modified (/wrap, /today), 3 new config files, 5 new vault directories, infrastructure (hot-reload, correlation IDs, vault index cache, dead-letter retry, instrumentation logs). Target: 60+ new tests, 150+ total.

## Decisions Captured

50 decisions (D-01 through D-50) written to 02-CONTEXT.md across 10 categories plus Claude's Discretion items and deferred backlog.

## Deferred Items

- 10 items to v1.1 backlog (email/calendar extraction, memory expiry, /promote-left, etc.)
- 7 items to plan-level resolution (daily note mechanic, concurrency, test strategy, etc.)

---

*Generated: 2026-04-22*
