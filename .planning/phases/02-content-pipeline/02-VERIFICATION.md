---
phase: 02-content-pipeline
verified: 2026-04-22T16:50:00Z
status: passed
score: 6/6 must-haves verified
re_verification: false
---

# Phase 2: Content Pipeline Verification Report

**Phase Goal:** Users can capture any input through /new with automatic domain classification and left/right routing, and memory compounds daily through a human-reviewed proposal/promotion workflow
**Verified:** 2026-04-22T16:50:00Z
**Status:** PASSED
**Re-verification:** No

## Goal Achievement

### Observable Truths

| # | Truth (from Success Criteria) | Status | Evidence |
|---|-------------------------------|--------|----------|
| 1 | Running /new with any input classifies it by domain and writes it to the correct vault location | VERIFIED | `src/new-command.js` exports `runNew` orchestrating 6-stage pipeline (Stage 0-5 + post-write wikilinks). `src/classifier.js` exports `classifyInput` with Stage 0 exclusion gate, Stage 1 voice gate (LEFT/RIGHT), Stage 2 subdirectory pick. 461/461 tests pass including integration-pipeline.test.js E2E flows. |
| 2 | Voice content, reflections, drafts route to LEFT; agent-derived content and summaries route to RIGHT | VERIFIED | `src/classifier.js` Stage 1 voice gate system prompt encodes LEFT signals (first-person, personal, emotional) vs RIGHT signals (structured, agent-generated, research). LEFT content routes to `proposals/left-proposals/` per D-12. `src/note-formatter.js` exports `formatLeftProposal` with left-proposal frontmatter format. |
| 3 | Excluded content (ISPN/Genesys/Asana) is blocked at /new ingress and never reaches disk | VERIFIED | `src/classifier.js` Stage 0 (`runStage0`) calls `checkContent` from `content-policy.js` as hard gate. BLOCK result returns immediately with no dead-letter (D-41). Internal failure fails closed with dead-letter `exclusion-unavailable`. Excluded terms loaded from `config/excluded-terms.json`. |
| 4 | After routing, /new suggests wikilinks to related existing notes | VERIFIED | `src/new-command.js` lines 231-238: post-write Stage 4 calls `suggestWikilinks` and `refreshIndexEntry` from `wikilink-engine.js`. Non-blocking per D-39 (try/catch, failure logged but never blocks). `src/wikilink-engine.js` implements hybrid search+LLM pipeline with vault index, scoring, Haiku re-rank, and graceful degradation. |
| 5 | Session activity produces memory candidates in memory-proposals.md with source attribution | VERIFIED | `src/memory-extractor.js` exports `extractFromTranscript` — reads JSONL transcripts, filters excluded messages, chunks oversized transcripts, sends to Haiku for candidate identification. `src/memory-proposals.js` exports `writeCandidate` with source attribution fields: `session_id`, `captured_at`, `source_file`, `source_ref`, `extraction_trigger`, `content_hash`. File locking via lockfile pattern. Dedup via content hashing. |
| 6 | Approved proposals promote to memory.md after human review, with batches capped at 5-10 items | VERIFIED | `src/promote-memories.js` exports `promoteMemories` — parses checkbox status (accept/reject/edit-then-accept/defer), promotes accepted candidates to `memory/memory.md` with batch cap enforced from `config/pipeline.json` (`batchCapMin: 5`, `batchCapMax: 10`). Dedup against existing memory.md and archive. Memory archive rotation by year. |

**Score: 6/6 truths verified**

### Required Artifacts

| Artifact | Exists | Substantive | Wired | Status |
|----------|--------|-------------|-------|--------|
| `src/classifier.js` | Yes | 518 lines, 4 exports (classifyInput, runStage0, runStage1, runStage2) | Imported by new-command.js, lifecycle.js, reroute.js, promote-unrouted.js | VERIFIED |
| `src/new-command.js` | Yes | 280 lines, 1 export (runNew) | Orchestrates classifier, note-formatter, vault-gateway, wikilink-engine | VERIFIED |
| `src/note-formatter.js` | Yes | 428 lines, 4 exports (formatNote, formatLeftProposal, generateFilename, extractTemplateFields) | Imported by new-command.js, lifecycle.js, promote-unrouted.js, reroute.js | VERIFIED |
| `src/wikilink-engine.js` | Yes | 530 lines, 4 exports (buildVaultIndex, loadVaultIndex, refreshIndexEntry, suggestWikilinks) | Imported by new-command.js, reroute.js, promote-unrouted.js | VERIFIED |
| `src/memory-extractor.js` | Yes | 514 lines, 4 exports (extractFromTranscript, extractFromFile, extractFromDirectory, extractMemories) | Imported by scripts/daily-sweep.js | VERIFIED |
| `src/memory-proposals.js` | Yes | 390 lines, 6 exports (generateCandidateId, writeCandidate, readProposals, acquireLock, releaseLock, flushPendingBuffer) | Imported by memory-extractor.js, briefing-helpers.js | VERIFIED |
| `src/promote-memories.js` | Yes | 377 lines, 1 export (promoteMemories) | Standalone command entry point | VERIFIED |
| `src/lifecycle.js` | Yes | 348 lines, 2 exports (retryDeadLetters, archiveStaleLeftProposals) | Imported by scripts/daily-sweep.js | VERIFIED |
| `src/briefing-helpers.js` | Yes | 127 lines, 3 exports (getProposalsPendingCount, getDeadLetterSummary, formatBriefingSection) | Data-access layer for Phase 4 /today consumption | VERIFIED |
| `scripts/daily-sweep.js` | Yes | 87 lines, orchestrates extractMemories + retryDeadLetters + archiveStaleLeftProposals | Entry point for scheduled execution | VERIFIED |
| `src/pipeline-infra.js` | Yes | Shared infrastructure (Haiku/Sonnet clients, correlation IDs, dead-letter writer, config loaders) | Imported by classifier, note-formatter, memory-extractor, wikilink-engine, lifecycle | VERIFIED |
| `src/promote-unrouted.js` | Yes | Dead-letter reclassification command | Imports classifier, wikilink-engine | VERIFIED |
| `src/reroute.js` | Yes | Reroute/reclassify command | Imports classifier, wikilink-engine | VERIFIED |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| new-command.js | classifier.js | `require('./classifier')` — runStage0, runStage1, runStage2 | WIRED |
| new-command.js | note-formatter.js | `require('./note-formatter')` — formatNote, formatLeftProposal, generateFilename | WIRED |
| new-command.js | vault-gateway.js | `require('./vault-gateway')` — vaultWrite | WIRED |
| new-command.js | wikilink-engine.js | `require('./wikilink-engine')` — suggestWikilinks, refreshIndexEntry (post-write) | WIRED |
| classifier.js | pipeline-infra.js | `require('./pipeline-infra')` — Haiku/Sonnet clients, writeDeadLetter | WIRED |
| classifier.js | content-policy.js | `require('./content-policy')` — checkContent (Stage 0) | WIRED |
| memory-extractor.js | memory-proposals.js | `require('./memory-proposals')` — writeCandidate | WIRED |
| briefing-helpers.js | memory-proposals.js | `require('./memory-proposals')` — readProposals | WIRED |
| daily-sweep.js | memory-extractor.js | `require('../src/memory-extractor')` — extractMemories | WIRED |
| daily-sweep.js | lifecycle.js | `require('../src/lifecycle')` — retryDeadLetters, archiveStaleLeftProposals | WIRED |
| lifecycle.js | classifier.js | `require('./classifier')` — classifyInput (lazy-loaded in retry loop) | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Status |
|----------|--------------|--------|--------|
| new-command.js | stage0Result, stage1Result, stage2Result | classifier.js -> pipeline-infra.js -> Haiku/Sonnet LLM API | FLOWING (LLM API calls via createHaikuClient/createSonnetClient) |
| memory-extractor.js | candidates | Haiku LLM classify() call on transcript/file corpus | FLOWING (LLM API via createHaikuClient) |
| memory-proposals.js | candidateId, content | writeCandidate() writes to proposals/memory-proposals.md on disk | FLOWING (filesystem write) |
| promote-memories.js | promoted candidates | readProposals() from memory-proposals.md + checkbox status parsing | FLOWING (filesystem read + parse) |
| wikilink-engine.js | index, rankedLinks | buildVaultIndex() scans vault dirs, suggestWikilinks() scores + Haiku re-rank | FLOWING (filesystem scan + LLM API) |
| briefing-helpers.js | proposals count, dead-letter summary | readProposals() + filesystem scan of proposals/unrouted/ | FLOWING (filesystem read) |

### Behavioral Spot-Checks

| Check | Command | Result |
|-------|---------|--------|
| Test suite passes | `npx jest --no-coverage --forceExit` | PASS — 461/461 tests, 24 suites, 0 failures |
| Config schemas valid | (covered by config-schemas.test.js) | PASS — batch cap min=5, max=10 confirmed |

### Requirements Coverage

| Requirement | Description | Plans | Status |
|-------------|-------------|-------|--------|
| INPUT-01 | `/new` classifies input by domain and routes to correct vault location | 01, 02 | SATISFIED — classifyInput orchestrates 3-stage pipeline, runNew writes to classified target |
| INPUT-02 | `/new` enforces left/right routing rules (voice/reflections -> LEFT, agent-derived -> RIGHT) | 02, 06 | SATISFIED — Stage 1 voice gate with LEFT/RIGHT signals, LEFT routes to proposals/left-proposals/ |
| INPUT-03 | `/new` integrates ingress filtering (excluded content never reaches disk) | 01, 02 | SATISFIED — Stage 0 exclusion gate calls checkContent, BLOCK returns immediately, no write |
| INPUT-04 | After routing, `/new` proposes wikilinks to related existing notes | 03, 05 | SATISFIED — post-write Stage 4 in new-command.js calls suggestWikilinks, enriches note with ## Related section |
| MEM-01 | `memory-proposals.md` extraction pipeline generates candidates with source attribution | 04, 05, 06 | SATISFIED — extractFromTranscript writes candidates with session_id, captured_at, source_file, content_hash |
| MEM-02 | `memory.md` promotion workflow moves approved proposals after human review | 05 | SATISFIED — promoteMemories parses accept/reject/edit checkboxes, appends to memory.md |
| MEM-03 | Proposal batches capped at 5-10 items | 05 | SATISFIED — pipeline.json batchCapMin=5, batchCapMax=10, enforced in promoteMemories |

**Orphaned requirements:** None. All 7 phase requirements (INPUT-01 through INPUT-04, MEM-01 through MEM-03) are covered by at least one plan and verified in code.

### Anti-Patterns Found

| Pattern | File | Severity | Assessment |
|---------|------|----------|------------|
| `return []` / `return {}` in error paths | Multiple files | Info | All instances are graceful degradation on file-not-found or API failure. Consistent with D-39 (enrichment failure never blocks). Not stubs. |
| "TODO" in memory-extractor.js:133 | src/memory-extractor.js | Info | Inside LLM system prompt exclusion rule ("TODO items and task lists"). Not a code TODO. |
| Worker process forced exit | jest test runner | Info | Timer leak from chokidar hot-reload watcher. Non-blocking; tests pass. |

**No blockers. No warnings.**

### Human Verification Required

### 1. LLM Classification Accuracy

**Test:** Run `/new` with diverse inputs (voice reflection, job posting, daily journal, structured data) against live Haiku API.
**Expected:** LEFT/RIGHT classification matches human judgment in 90%+ of cases; subdirectory picks are reasonable.
**Why human:** Classification quality depends on LLM behavior which cannot be verified with mocked tests.

### 2. Wikilink Relevance

**Test:** After building vault index on a populated vault, run `/new` with content related to existing notes.
**Expected:** Suggested wikilinks point to genuinely related notes with meaningful 6-word reasons.
**Why human:** Relevance is subjective and depends on vault content.

### 3. Memory Proposal Review UX

**Test:** Open `proposals/memory-proposals.md` in Obsidian, check accept/reject checkboxes on several candidates, then run `/promote-memories`.
**Expected:** Accepted candidates appear in `memory/memory.md` with correct formatting; rejected candidates are marked; batch cap respected.
**Why human:** Checkbox parsing and Obsidian rendering interaction needs manual confirmation.

## Architecture Score

| Dimension | Weight | Score | Status |
|-----------|--------|-------|--------|
| Security | 35% | 82 | PASS |
| Performance | 25% | 75 | PASS |
| Correctness | 25% | 85 | PASS |
| Maintainability | 15% | 78 | PASS |
| **Overall** | **100%** | **80.6** | **PASS** |

### Criteria Detail

**Security (82/100)**

1. **Prompt injection resistance (7/10):** LLM system prompts are hardcoded, not user-influenced. Input content passed as user message. No explicit input sanitization before LLM calls, but content-policy gate catches excluded terms.
2. **Permission boundaries (9/10):** vault-gateway enforces LEFT write prohibition. Content-policy blocks ISPN/Genesys/Asana at ingress (Stage 0). Write-gateway is single enforcement point.
3. **Secret handling (8/10):** Anthropic API key accessed via SDK defaults (environment variable), not hardcoded. No credentials in config files.
4. **Input validation (8/10):** Empty input handled. Config loaded with required-field validation via JSON schemas. File paths constructed from config, not user input.

**Performance (75/100)**

5. **Resource bounds (7/10):** maxTokens set on all LLM calls (256-1024). Transcript chunking with 100-message windows and overlap. Pipeline config has thresholds for all timeouts.
6. **Lazy loading (7/10):** Vault index cached to .cache/vault-index.json (no full scan per /new). Config loaded per-call but lightweight. Pipeline-infra creates LLM clients on demand.
7. **Concurrency design (8/10):** File locking for memory-proposals.md concurrent access. Pending buffer for lock contention. Daily sweep operations run sequentially (correct for single-user system).

**Correctness (85/100)**

8. **Error handling (9/10):** Every LLM call has failure path (never-throw pattern). Dead-letter system catches all post-Stage-0 failures. Wikilink enrichment non-blocking. Lifecycle operations idempotent.
9. **Edge case coverage (8/10):** Empty input, short input, non-interactive mode, API failure, duplicate detection, oversized transcripts, frozen dead-letters. Good coverage.
10. **Type safety (7/10):** CommonJS without TypeScript. Function signatures documented with JSDoc. Config validated against JSON schemas. Reasonable for a Node.js project without TS.
11. **Test coverage (9/10):** 461 tests across 24 suites. Integration tests for E2E pipeline. Unit tests for every module. Mocking strategy consistent.

**Maintainability (78/100)**

12. **Naming clarity (8/10):** Function names are descriptive (runStage0, classifyInput, formatLeftProposal, promoteMemories). Correlation IDs propagated throughout. Decision references (D-XX) in comments.
13. **Single responsibility (8/10):** Clear module boundaries: classifier, formatter, wikilink engine, memory extractor, memory proposals, lifecycle, briefing helpers. Each has focused purpose.
14. **Dependency hygiene (7/10):** Only two external deps added (chokidar@3, @anthropic-ai/sdk). No circular imports detected. Pipeline-infra is shared but lightweight.

---

_Verified: 2026-04-22T16:50:00Z_ / _Verifier: Claude (gsd-verifier scope:general)_
