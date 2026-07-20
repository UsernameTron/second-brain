# Phase 34: Promotion Integrity & Lifecycle - Context

**Gathered:** 2026-07-20
**Status:** Ready for planning
**Source:** PRD Express Path (`.planning/research/DREAM-CONSOLIDATION-DESIGN.md` + operator directive 2026-07-20)

<domain>
## Phase Boundary

Four roadmap bullets (`.planning/ROADMAP.md:28`):
1. Land filed backlog PROMOTE-PARSE-01 / PROMOTE-VAULT-01 / PROMOTE-ID-01 / VERIFY-SENTINEL-01 (definitions: `.planning/milestones/v1.7-REQUIREMENTS.md:79-85`).
2. Contradiction check at promotion — hybrid top-5, flag-only, never block/auto-resolve.
3. `superseded-by::` entry convention — `src/memory-reader.js` downranks.
4. Monthly snapshot-first dream-consolidation: propose script + launchd plist, stages for human review, no auto-apply. Full design: `.planning/research/DREAM-CONSOLIDATION-DESIGN.md`.

Out of scope: Phase 35 session injection, Phase 36 connectors, any auto-apply path, any delete path for memory entries.

</domain>

<decisions>
## Implementation Decisions

### Gate parser sharing (OPERATOR HARD CONSTRAINT)
- The `/dream-apply` changeset parser MUST share the exactly-one-checkbox parsing logic with the promotion gate — extract it from `src/promote-memories.js:104-152` into a shared helper in `src/memory-proposals.js` and have BOTH gates call it. No second implementation: two gate parsers will drift.
- This extraction is also where PROMOTE-PARSE-01's fix lands (whitespace-tolerant checkbox regex + loud near-miss counting) — fix it once in the shared helper, both gates inherit it.

### Backlog fixes (locked, per v1.7-REQUIREMENTS.md:79-85)
- PROMOTE-PARSE-01: tolerate checkbox whitespace variants; count near-miss checkbox lines and fail loudly when candidates carry unparseable marks (no more silent `promoted 0`).
- PROMOTE-VAULT-01: make `VAULT_ROOT` resolution call-time in `src/memory-proposals.js:18` (match promote-memories.js pattern); assert both modules agree on the resolved root at promotion start.
- PROMOTE-ID-01: make proposal IDs collision-safe across files/roots (per-root discriminator or archive-aware max scan).
- VERIFY-SENTINEL-01: `scripts/verify-baseline.js` with real pass/fail exit code checking the 27 content_hash values from `memory.md.pre-governance.20260712`; wired into milestone reporting so no report cites baseline integrity without a run artifact.

### Dream consolidation (locked, per DREAM-CONSOLIDATION-DESIGN.md — the design doc is authoritative detail)
- Commands `/dream-propose` and `/dream-apply` (NOT `/dream` — collides with the existing `dream-memory-consolidation` skill that targets Claude Code MEMORY.md files, a different store).
- Inputs: memory.md + embeddings sidecar (all live entries, local cosine, zero tokens); `state/session-log.md` + `state/decisions.md` windowed by `state/dream-ledger.json`. Transcripts and standups are NOT read (daily-sweep already mines transcripts forward).
- Three ops, all proposals, never applied edits: MERGE (cosine ≥0.90, Sonnet-authored, verbatim quotes from both sources mechanically verified as substrings, sources superseded never deleted), STALE (flag-only: contradicted / dead-reference / age>180d in ephemeral categories), MISSED PATTERNS (plain ADDs into the existing memory-proposals.md gate, deduped by content_hash AND cosine ≥0.86).
- MERGE/STALE changeset: `proposals/dream-changeset-YYYY-MM.md`, one per run; propose refuses while an unresolved changeset exists; checkbox mechanics via the shared parser.
- Apply (`/dream-apply`, human-invoked only, batch cap 5-10): snapshot memory.md + embeddings.jsonl + index.db to `memory/.snapshots/dream-YYYYMMDD/` FIRST → proposals lock → apply ops → regenerateAutoIndex → indexNewEntries (old embeddings kept) → SQLite rebuild + reach export + `--strict` drift check → mandatory `npm run eval:recall`, exit 1 → auto-restore snapshot and abort.
- Schedule: `com.secondbrain.dream.plist`, monthly day 1 07:15, `--propose` only; apply never scheduled. Built to Phase 33's plist conventions.
- Config: `dream` block in `config/pipeline.json` + schema: `{enabled, mergeCosineMin: 0.90, patternDedupCosine: 0.86, maxMergeOps: 15, maxStaleFlags: 10, maxPatternAdds: 5, staleAgeDays: 180, sessionLogWindow: 30, maxLLMCalls: 40}`.

### Ordering constraints
- `superseded-by::`/`stale::` downranking in memory-reader.js and the shared contradiction-check helper are prerequisites of the dream work — build once, promotion gate and dream both call them.
- Shared checkbox parser extraction is a behavior-preserving refactor first (existing promote-memories tests stay green), then dream builds on it.

### Claude's Discretion
- Exact module layout of `src/dream.js` internals; chunking strategy for the pattern-extraction Sonnet calls; snapshot retention policy; ledger schema details; test file organization.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design
- `.planning/research/DREAM-CONSOLIDATION-DESIGN.md` — full dream-consolidation design: ops, changeset format, apply sequence, guards, config
- `.planning/ROADMAP.md` (line 28) — Phase 34 bullet list
- `.planning/milestones/v1.7-REQUIREMENTS.md` (lines 79-85) — the four backlog item definitions with observed failures and prescribed fixes

### Code to modify / reuse
- `src/promote-memories.js` — gate mechanics; checkbox parsing at :104-152 (extraction source); `regenerateAutoIndex`, `appendToMemoryFile`, archive functions
- `src/memory-proposals.js` — lock/hash/frontmatter helpers to reuse; VAULT_ROOT bug at :18; `generateCandidateId` at :51-57
- `src/memory-reader.js` — downranking target
- `src/semantic-index.js` — `readAllEmbeddings()`, `indexNewEntries()`, `hybridSearch()`
- `src/pipeline-infra.js` — `createHaikuClient()` / `createSonnetClient()`
- `scripts/build-index.js` — SQLite rebuild + `--strict` drift check
- `config/pipeline.json` + `config/schema/` — dream config block home

### Verification infrastructure
- `eval/golden-recall.json`, `eval/baseline-2026-07-19.json`, `scripts/eval-recall.js` — the recall-regression gate the apply sequence must run
- `.planning/milestones/v1.8-phases/32-retrieval-eval/32-01-PLAN.md` — PLAN.md format precedent

</canonical_refs>

<specifics>
## Specific Ideas

- Changeset op format (frontmatter, `sources::`, `similarity::`, `golden-hash::`, inline `merged-entry::`) is spelled out verbatim in the design doc — copy it, don't redesign.
- `golden-hash:: YES` stamped when a source/target hash appears in `eval/golden-recall.json`.
- Tests named in the design doc: fabricated-quote merge rejected; apply → eval-fail → snapshot-restore round-trip on the frozen seed vault; propose refuses on unresolved changeset; both gates exercised through the same shared checkbox parser (multi-box → ambiguous → skipped in each).

</specifics>

<deferred>
## Deferred Ideas

- Physical deletion/compaction of superseded entries — stays with the existing year-archive sweep.
- Auto-apply of any consolidation op — permanently out of scope by design.
- Connector-fed memory (Phase 36).

</deferred>

---

*Phase: 34-promotion-integrity-lifecycle*
*Context gathered: 2026-07-20 via PRD Express Path*
