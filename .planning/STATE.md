---
gsd_state_version: 1.0
milestone: v1.4
milestone_name: Memory Activation & Final Closeout
status: executing
stopped_at: Completed Phase 20 Plan 02 — daily-stats core module
last_updated: "2026-04-25T15:33:52.207Z"
last_activity: 2026-04-25
progress:
  total_phases: 9
  completed_phases: 6
  total_plans: 26
  completed_plans: 23
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-24)

**Core value:** Memory compounds daily. Every session, conversation, and capture adds to a growing knowledge base that makes tomorrow's work faster and more informed than today's.
**Current focus:** Phase 20 — value-extraction-instrumentation

## Current Position

Phase: 20 (value-extraction-instrumentation) — EXECUTING
Plan: 3 of 5
Status: Ready to execute
Last activity: 2026-04-25

**Shipped milestones:** v1.0 (MVP, 2026-04-22), v1.1 (Go Live, 2026-04-23), v1.2 (Automation & Quality, 2026-04-23), v1.3 (Review Remediation, 2026-04-24).

**Tags:** v1.0, v1.1, v1.2.0, v1.3.0.

**Planned phases (v1.4):** Phase 17 UAT CI, Phase 18 Memory Retrieval, Phase 19 Semantic Memory, Phase 20 Instrumentation, Phase 21 Closeout Hygiene.

## Milestone v1.4 Locked Decisions

1. **Search depth:** Keyword (Phase 18) + semantic (Phase 19) both ship
2. **Embedding provider:** Voyage AI (HTTP API, `VOYAGE_API_KEY`)
3. **`/new` behavior:** Untouched — retrieval surfaces only via `/recall` and `/today` Memory Echo
4. **Hygiene:** Phase 21 included — v1.4 is the closing milestone, nothing carries forward
5. **Research:** 4 parallel research agents run before REQUIREMENTS.md (Voyage embeddings + vector indexing for markdown corpora)

## Backlog (folded into v1.4 or accepted)

| ID | Item | Disposition |
|----|------|-------------|
| B-21 | UAT CI strategy — 24 UAT tests skipped in CI | Phase 17 |
| B-15 | No Unicode-specific tests for exclusion terms | Phase 21 |
| B-18 | No JSDoc on public API surface | Phase 21 |
| B-20 | 41 no-console warnings across src/ | Phase 21 |
| — | Configure branch protection on master (v1.2 carry-forward) | Phase 17 |
| F-01 | chokidar v3.6.0 (2 majors behind, CJS compat) | Accepted — no action |
| F-02 | docs-sync agent lacks scope_guard | Accepted — no action |

## Accumulated Context

### Decisions

Full log in PROJECT.md Key Decisions table. Summary:

- v1.0/v1.1: architectural + integration decisions (vault boundary, pipeline stages, connector topology)
- v1.2: automation & quality decisions (hooks, agents, CI, local LLM)
- v1.3: remediation decisions (config overlay, architecture decomposition, test quality focus)
- v1.4: memory activation decisions (Voyage embeddings, `/new` untouched, keyword+semantic both ship)
- [Phase 17-uat-ci-infrastructure]: ANTHROPIC_API_KEY scoped at step-level env only in uat.yml — never job-level or workflow-level (P11 prevention)
- [Phase 17-uat-ci-infrastructure]: Monday 13:00 UTC cron for UAT workflow — 7 hours after CodeQL 06:00 UTC to prevent runner contention
- [Phase 17-uat-ci-infrastructure]: test:uat:ci script is bare jest invocation — CI env owned by workflow step not the npm script
- [Phase 17-uat-ci-infrastructure]: nock@14.0.13 pre-installed in Phase 17 infrastructure so Phase 19 semantic search planning stays architecture-focused
- [Phase 17-uat-ci-infrastructure]: enforce_admins: false — repo owner retains emergency push bypass with explicit GitHub admin-bypass warning; non-admin contributors and force-push blocked; deliberate tradeoff for solo-developer repo
- [Phase 17-uat-ci-infrastructure]: UAT Accuracy Tests intentionally NOT a required branch protection check — workflow runs on schedule/dispatch only, never on PRs; requiring it would permanently block all PR merges
- [Phase 19]: voyageai@0.2.1 pinned exact (no caret) per D-PRE-01 locked decision; MIT license passes allowlist
- [Phase 19]: memory.semantic is optional sub-object in schema — pipeline.json without semantic block still validates; semantic is additive
- [Phase 19]: voyage-health.js uses atomic .tmp rename + chmod 0600/0700 for cross-invocation state; computeSchemaVersion hashes model+dim only (D-14)
- [Phase 19]: checkContent() gate runs before every Voyage call in semanticSearch() — excluded terms never leave the process (Pattern 11, D-PRE-05)
- [Phase 19]: Lazy require('./semantic-index') in promote-memories try/catch — embed-on-promotion is best-effort; promotion never blocked by embed failure
- [Phase 19]: recall-command --semantic/--hybrid use lazy require per branch — keyword-only /recall never loads semantic-index
- [Phase 19]: D-03 batch retry fires once on ANY failure independent of D-08 SDK-level 429 retry — total embed calls for any indexNewEntries failure = 2 minimum
- [Phase 19]: pipeline.json schema uses additionalProperties:false preventing excludedTerms key — integration tests must inject terms via safeLoadPipelineConfig spy
- [Phase 19]: DELTA.md grounding pass required before any doc edit — prevents invented file paths (lesson from Phase 16 docs-sync incident)
- [Phase 19]: DEVOPS-HANDOFF.md rewritten from bootstrap stub — stub was factually incorrect (claimed no external services, but system has 4 integrations)
- [Phase 20]: stats sub-object is optional in pipeline schema (not in required array) — backward-compatible additive change; timezone defaults to America/Chicago (D-08/REQ-AMEND-01)
- [Phase 20]: stats.path stores vault-relative path (RIGHT/daily-stats.md); absolute resolution via VAULT_ROOT at runtime per vault-gateway.js Pattern 11 convention

### Open Blockers

None active.

### Pending Todos

- Run /gsd:plan-phase 20 to plan Value Extraction Instrumentation (CONTEXT.md committed 4a9bb8d)

## Session Continuity

Last session: 2026-04-25T15:33:52.205Z
Stopped at: Completed Phase 20 Plan 02 — daily-stats core module
Ship log: PRs #1–#31 merged. Tags: v1.0, v1.1, v1.2.0, v1.3.0.
