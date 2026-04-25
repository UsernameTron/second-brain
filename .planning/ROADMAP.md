# Roadmap: Second Brain

## Overview

Transform an Obsidian vault into a personal operating system with compounding memory, proactive daily briefing, intelligent input routing, and external integrations.

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped 2026-04-22)
- ✅ **v1.1 Go Live** — Phases 5-7 (shipped 2026-04-23)
- ✅ **v1.2 Automation & Quality** — Phases 8-11 (shipped 2026-04-23, tag v1.2.0)
- ✅ **v1.3 Review Remediation** — Phases 12-16 (shipped 2026-04-24, tag v1.3.0)
- 🚧 **v1.4 Memory Activation & Final Closeout** — Phases 17-21 (in progress)

## Phases

<details>
<summary>🚧 v1.4 Memory Activation & Final Closeout (Phases 17-21) — IN PROGRESS</summary>

- [ ] **Phase 17: UAT CI Infrastructure** — Close the UAT CI gap and enforce branch protection on master
- [ ] **Phase 18: Memory Retrieval Foundation** — Activate the read path on the write-only memory layer with keyword search and `/recall`
- [ ] **Phase 19: Semantic Memory Search** — Add Voyage AI semantic retrieval with RRF hybrid mode and graceful degradation
- [ ] **Phase 20: Value Extraction Instrumentation** — Make the "memory compounds daily" promise visible and measurable
- [ ] **Phase 21: Closeout Hygiene** — Clear every deferred hygiene item and produce final v1.4 documentation

</details>

<details>
<summary>✅ v1.0 MVP (Phases 1-4) — SHIPPED 2026-04-22</summary>

- [x] Phase 1: Vault Foundation (2/2 plans) — completed 2026-04-21
- [x] Phase 2: Content Pipeline (6/6 plans) — completed 2026-04-21
- [x] Phase 3: External Integrations (4/4 plans) — completed 2026-04-22
- [x] Phase 4: Daily Briefing and Scheduling (3/3 plans) — completed 2026-04-22

Full details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

<details>
<summary>✅ v1.1 Go Live (Phases 5-7) — SHIPPED 2026-04-23</summary>

- [x] Phase 5: Integration Wiring (3/3 plans) — completed 2026-04-23
- [x] Phase 6: Defect Fixes and UAT (3/3 plans) — completed 2026-04-23
- [x] Phase 7: Hardening (1/1 plan) — completed 2026-04-23

Full details: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

</details>

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Vault Foundation | v1.0 | 2/2 | Complete | 2026-04-21 |
| 2. Content Pipeline | v1.0 | 6/6 | Complete | 2026-04-21 |
| 3. External Integrations | v1.0 | 4/4 | Complete | 2026-04-22 |
| 4. Daily Briefing and Scheduling | v1.0 | 3/3 | Complete | 2026-04-22 |
| 5. Integration Wiring | v1.1 | 3/3 | Complete | 2026-04-23 |
| 6. Defect Fixes and UAT | v1.1 | 3/3 | Complete | 2026-04-23 |
| 7. Hardening | v1.1 | 1/1 | Complete | 2026-04-23 |
| 8. Hook Infrastructure | v1.2 | 3/3 | Complete | 2026-04-23 |
| 9. Security & Verification | v1.2 | 3/3 | Complete | 2026-04-23 |
| 10. Agent Hardening & Skills | v1.2 | 2/2 | Complete | 2026-04-23 |
| 11. CI & LLM Infrastructure | v1.2 | 2/2 | Complete | 2026-04-23 |
| 12. Critical Safety Fixes | v1.3 | 6/6 | Complete | 2026-04-23 |
| 13. Config Schema Gaps | v1.3 | — | Complete | 2026-04-23 |
| 14. CI Hardening | v1.3 | 5/5 | Complete | 2026-04-24 |
| 15. Architecture Refactor | v1.3 | — | Complete | 2026-04-24 |
| 16. Test Quality | v1.3 | — | Complete | 2026-04-24 |

## v1.2 Automation & Quality (Phases 8-11)

**Goal:** Close quality, security, and automation gaps identified by agent-teams assessment, crew analysis, and automation recommender. No new features — hardening the development workflow and CI pipeline.

### Phase 8: Hook Infrastructure
**Requirements:** HOOK-01, HOOK-02, HOOK-03
**Depends on:** None (creates .claude/settings.json as prerequisite for hooks)
**Goal:** Wire Claude Code hooks for auto-test, protected file guard, and security scan gate.

Plans:
- [ ] TBD (plan with /gsd:plan-phase 8)

### Phase 9: Security & Verification
**Requirements:** SEC-01, SEC-02, SEC-03
**Depends on:** Phase 8 (HOOK-03 depends on SEC-01 agent existing; SEC-03 skill is independent)
**Goal:** Deploy security scanner agent, independent test verifier, and config validation skill.

Plans:
- [ ] TBD (plan with /gsd:plan-phase 9)

### Phase 10: Agent Hardening & Skills
**Requirements:** SKILL-01, SKILL-02, SKILL-03
**Depends on:** Phase 9 (agent hardening informed by new agents in Phase 9)
**Goal:** Harden existing 4 agents, create pipeline health skill, install context7 MCP.

**Plans:** 2 plans

Plans:
- [x] 10-01-PLAN.md — Agent roster hardening (SKILL-01) + context7 MCP install (SKILL-03) — completed 2026-04-23
- [x] 10-02-PLAN.md — Pipeline health check skill (SKILL-02) — completed 2026-04-23

### Phase 11: CI & LLM Infrastructure
**Requirements:** CI-01, CI-02
**Depends on:** Phase 9 (CI coverage enforcement needs passing coverage baseline)
**Goal:** Enforce coverage in CI, wire local LLM as Haiku fallback.

**Plans:** 2/2 plans complete

Plans:
- [ ] 11-01-PLAN.md — Local LLM routing in createLlmClient() with Haiku fallback (CI-02)
- [ ] 11-02-PLAN.md — Coverage gap tests + CI coverage enforcement + npm audit (CI-01)

## Backlog (Post-v1.2)

All 12 items from v1.0/v1.1 backlog (999.1–999.12) promoted to v1.2 phases 8–11.
No remaining backlog items. New items added here as discovered.

---

## v1.4 Memory Activation & Final Closeout (Phases 17-21)

**Goal:** Activate the write-only memory layer (keyword + semantic retrieval), prove memory compounds daily via instrumentation, close the UAT CI gap, and clear every deferred hygiene item. This is the closing milestone.

**Requirements:** 19 total — 100% mapped, no orphans.

### Phase 17: UAT CI Infrastructure
**Goal**: CI pipeline runs UAT tests on a reliable schedule with secret isolation, and master branch is protected against force-push and failing checks.
**Depends on**: Nothing (independent of Phases 18–21)
**Requirements**: UAT-CI-01, UAT-CI-02, BRANCH-PROT-01
**Success Criteria** (what must be TRUE):
  1. A GitHub Actions workflow runs `npm run test:uat:ci` automatically on a weekly cron and on manual `workflow_dispatch`, with both trigger modes passing.
  2. After a UAT run, the workflow run page shows a downloadable artifact containing the accuracy report, retained for 90 days.
  3. A direct push to master that would skip CI (or a force-push) is rejected by branch protection; only PRs with passing lint, tests, coverage, and CodeQL checks can merge.
  4. The `ANTHROPIC_API_KEY` secret is scoped exclusively to the UAT job and does not appear in any other workflow step or log output.

**Plans:** 3/3 plans complete

Plans:
- [x] 17-01-PLAN.md — Scheduled UAT workflow with secret isolation and 90-day artifact retention (UAT-CI-01, UAT-CI-02)
- [x] 17-02-PLAN.md — test:uat:ci npm script + nock@14.0.13 devDependency for Phase 19 mock infrastructure (UAT-CI-01 support)
- [x] 17-03-PLAN.md — Branch protection on master via gh api + human verification checkpoint (BRANCH-PROT-01)

### Phase 18: Memory Retrieval Foundation
**Goal**: Users can query the compounding memory layer via `/recall` and see relevant memories surfaced automatically in the `/today` briefing.
**Depends on**: Nothing (foundational; unblocks Phases 19 and 20)
**Requirements**: MEM-READ-01, MEM-SEARCH-KW-01, RECALL-CMD-01, TODAY-ECHO-01
**Success Criteria** (what must be TRUE):
  1. Running `/recall "leadership"` returns a numbered list of up to 5 memory entries with category label, 100-character snippet, and source reference — or an empty result set with no error when no entry matches.
  2. `/recall` supports `--category`, `--since`, and `--top N` flags that each narrow or expand results as documented.
  3. Running `/recall` against a vault where `memory/memory.md` is absent returns an empty result set without throwing or crashing.
  4. The `/today` briefing includes a "Memory Echo" section (between Frog and Pipeline) when at least one memory entry scores above the 0.65 relevance threshold against today's calendar topics or VIP email subjects; the section is absent entirely when no entry crosses the threshold.

**Plans:** 6/6 plans complete

Plans:
- [x] 18-01-PLAN.md — Extract shared memory utilities (computeHash, sourceRefShort) to src/utils/memory-utils.js
- [x] 18-02-PLAN.md — Add minisearch@^7.2.0 dependency + pipeline schema extension for memory.echoThreshold
- [x] 18-03-PLAN.md — src/memory-reader.js (readMemory, searchMemoryKeyword, getMemoryEcho) — MEM-READ-01, MEM-SEARCH-KW-01
- [x] 18-04-PLAN.md — src/recall-command.js (runRecall, parseRecallArgs) — RECALL-CMD-01
- [x] 18-05-PLAN.md — Memory Echo integration in today-command.js + briefing-renderer.js — TODAY-ECHO-01
- [x] 18-06-PLAN.md — Integration + UAT tests covering all 4 Phase 18 ROADMAP success criteria (completed 2026-04-24)

### Phase 19: Semantic Memory Search
**Goal**: `/recall` surfaces semantically relevant memories that keyword search misses, with automatic fallback to keyword mode when Voyage AI is unavailable.
**Depends on**: Phase 18 (semantic-index.js calls readMemory() for hash-set comparison)
**Requirements**: MEM-EMBED-01, MEM-SEMANTIC-01, MEM-INDEX-REFRESH-01, MEM-DEGRADE-01
**Success Criteria** (what must be TRUE):
  1. After running `/promote-memories`, each newly promoted entry is embedded via Voyage AI (`voyage-4-lite`) and appended to `~/.cache/second-brain/embeddings.jsonl`; running `/promote-memories` a second time with the same entries produces zero additional Voyage API calls (content-hash cache confirmed).
  2. `/recall --semantic "emotional resilience"` returns entries ranked by cosine similarity with temporal decay, filtered at the 0.72 threshold, without surfacing entries that contain excluded terms.
  3. `/recall --hybrid` returns results that combine keyword and semantic ranks via RRF fusion, producing a merged ranked list.
  4. When `VOYAGE_API_KEY` is absent or Voyage returns a 5xx/timeout, `/recall --semantic` and `/recall --hybrid` fall back to keyword results and emit a single-line degradation notice; Memory Echo in `/today` continues using keyword match with no error in the briefing.
  5. On startup, the index self-heals: entries present in `memory.md` but absent from `embeddings.jsonl` are re-embedded lazily; a `schema_version` mismatch in `index-metadata.json` triggers a full re-embed before results are served.
**Plans**: TBD

### Phase 20: Value Extraction Instrumentation
**Goal**: Every `/today` run records measurable evidence that memory is compounding, and the briefing opens with a one-line summary of yesterday's growth.
**Depends on**: Phase 18 (Memory Echo latency is meaningful to track); Phase 19 (semantic latency is the primary metric worth capturing)
**Requirements**: STATS-DAILY-01, STATS-LATENCY-01, STATS-GROWTH-01, TODAY-SUMMARY-01
**Success Criteria** (what must be TRUE):
  1. After each `/today` run, `~/Claude Cowork/RIGHT/daily-stats.md` contains exactly one row for the current calendar day (local timezone `America/Los_Angeles`) with columns: date, proposals, promotions, total_entries, memory_kb, recall_count, avg_latency_ms, avg_confidence.
  2. Running `/today` twice on the same day updates the existing row rather than appending a duplicate row.
  3. The `/today` briefing opens with a one-line summary — e.g., "Yesterday: +3 proposals, +2 promotions, +1.4 KB memory" — drawn from the prior day's stats row; the line is omitted when no prior-day row exists (first run ever).
  4. The stats row captures per-connector latency (calendar, Gmail, GitHub) and per-operation latency (semanticSearch, memoryEcho) alongside the end-to-end `/today` latency.

**Plans:** 1/5 plans executed

Plans:
- [x] 20-01-PLAN.md — Pipeline schema extension: stats sub-object (enabled, path, timezone, summaryLineEnabled, schemaVersion) + defaults — STATS-DAILY-01
- [ ] 20-02-PLAN.md — src/daily-stats.js core module: dateKey() with America/Chicago + DST + 23:59/00:01 boundary tests, atomic .tmp+rename writer, gray-matter frontmatter, idempotent same-day rewrite — STATS-DAILY-01, STATS-GROWTH-01
- [ ] 20-03-PLAN.md — Counter emit points: recall_count in recall-command (D-04: Memory Echo NOT counted), proposals/promotions/avg_confidence in promote-memories, top-1 cosine in semantic-index, top-1 RRF in --hybrid (D-07 emit-only), latency timing harness in today-command — STATS-DAILY-01, STATS-LATENCY-01
- [ ] 20-04-PLAN.md — today-command.js orchestrator integration: recordStats step after briefing-renderer, lazy require, every call try/catch-wrapped (D-06 briefing-is-the-product), end-to-end integration test — STATS-DAILY-01, STATS-LATENCY-01, STATS-GROWTH-01
- [ ] 20-05-PLAN.md — Verbatim 5-delta summary-line prepend: buildYesterdaySummaryLine() pure formatter + briefing-renderer integration with silent suppression on every degenerate path — TODAY-SUMMARY-01

### Phase 21: Closeout Hygiene
**Goal**: Every deferred hygiene item from v1.3 is closed, public API surface is documented, and all three living documents accurately describe v1.4.
**Depends on**: Phase 18, Phase 19, Phase 20 complete (JSDoc requires stable public APIs from all three)
**Requirements**: HYG-UNICODE-01, HYG-JSDOC-01, HYG-CONSOLE-01, DOCS-FINAL-01
**Success Criteria** (what must be TRUE):
  1. The `test/content-policy.test.js` suite includes at least one test per excluded term exercising Unicode variants (curly quotes, em-dashes, smart apostrophes, non-ASCII whitespace), and all new tests pass in CI.
  2. Every public function exported from the ten named source files (`classifier.js`, `memory-extractor.js`, `memory-proposals.js`, `promote-memories.js`, `memory-reader.js`, `semantic-index.js`, `recall-command.js`, `daily-stats.js`, `today-command.js`, `vault-gateway.js`) has a JSDoc block with `@param`, `@returns`, and a one-line description.
  3. The 41 `no-console` ESLint warnings are eliminated — either via a shared logger abstraction or via documented `eslint-disable` comments with per-call-site rationale — and `npm run lint` exits clean.
  4. `CLAUDE.md`, `README.md`, and `docs/DEVOPS-HANDOFF.md` accurately document `/recall`, `VOYAGE_API_KEY`, the `memory.*` and `stats.*` config keys, `daily-stats.md`, and `~/.cache/second-brain/embeddings.jsonl`, with final test counts and coverage numbers filled in.
**Plans**: TBD

---

## v1.4 Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 17. UAT CI Infrastructure | 3/3 | Complete    | 2026-04-24 |
| 18. Memory Retrieval Foundation | 6/6 | Complete    | 2026-04-24 |
| 19. Semantic Memory Search | 5/5 | Complete    | 2026-04-24 |
| 20. Value Extraction Instrumentation | 1/5 | In Progress|  |
| 21. Closeout Hygiene | 0/? | Not started | - |

---

## v1.4 Requirement Coverage

| REQ-ID | Phase | Description (abbreviated) |
|--------|-------|---------------------------|
| UAT-CI-01 | 17 | Scheduled + workflow_dispatch UAT workflow with secret isolation |
| UAT-CI-02 | 17 | UAT accuracy report artifact retained 90 days |
| BRANCH-PROT-01 | 17 | Branch protection on master enforcing CI + blocking force-push |
| MEM-READ-01 | 18 | `readMemory()` parses memory.md into structured entries, never throws |
| MEM-SEARCH-KW-01 | 18 | Keyword search with AND, phrase, negation, category/date filters, snippets |
| RECALL-CMD-01 | 18 | `/recall <query>` with `--category`, `--since`, `--top N` flags |
| TODAY-ECHO-01 | 18 | Memory Echo section in `/today` with 0.65 threshold, omitted when empty |
| MEM-EMBED-01 | 19 | Embed-on-promotion via Voyage AI with content-hash dedup |
| MEM-SEMANTIC-01 | 19 | `semanticSearch()` with cosine + temporal decay + excluded-terms filter |
| MEM-INDEX-REFRESH-01 | 19 | Startup hash-set comparison; schema_version triggers full re-embed |
| MEM-DEGRADE-01 | 19 | Graceful fallback to keyword when Voyage unavailable |
| STATS-DAILY-01 | 20 | `appendDailyStats()` idempotent append to `RIGHT/daily-stats.md` |
| STATS-LATENCY-01 | 20 | Per-connector and per-operation latency captured in stats row |
| STATS-GROWTH-01 | 20 | `memory_kb` + `total_entries` per day; timezone-safe date utility |
| TODAY-SUMMARY-01 | 20 | One-line yesterday summary at top of `/today` briefing |
| HYG-UNICODE-01 | 21 | Unicode-variant exclusion term tests in content-policy.test.js |
| HYG-JSDOC-01 | 21 | JSDoc on all public exports across 10 named modules |
| HYG-CONSOLE-01 | 21 | 41 no-console warnings resolved; lint exits clean |
| DOCS-FINAL-01 | 21 | CLAUDE.md, README.md, DEVOPS-HANDOFF.md reflect v1.4 final state |

**Coverage: 19/19 requirements mapped. No orphans.**
