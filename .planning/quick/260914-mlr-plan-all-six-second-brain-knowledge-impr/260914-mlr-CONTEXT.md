# Six Second Brain improvements — planning context

Date: 2026-09-14. Authorization: create a plan only. No feature implementation, live memory writes, runtime activation, dependency installation, or remote publication is authorized by this request.

## Requested scope

1. Living project/topic pages.
2. Answers with inspectable evidence and an original-sources mode.
3. Simpler current-fact review with current/proposed values and accept/edit/defer/reject.
4. PDF, DOCX, and web-page capture with preserved originals and incremental processing.
5. Purpose-aware retrieval using project goals/questions, aliases, and linked pages.
6. Saving useful answers as attributed, revisable analysis notes.

All six must receive implementation tasks, acceptance criteria, dependencies, and a clear user flow. This is an improvement to the existing Second Brain, not adoption of another application or fact store. Use Obsidian and CLI as the initial surfaces. Agent Canvas is a separate application and not a dependency.

## Verified current architecture

- Active runtime source: `/Users/cpconnor/.local/share/second-brain/runtime` at `3fc324b500578080201c85eb2a20856b61904f83`, matching adjacent `runtime-revision`; clean detached checkout when inspected.
- Canonical memory: `/Users/cpconnor/Claude Cowork/memory/memory.md`.
- The current working checkout `/Users/cpconnor/projects/second-brain` is branch `codex/agent-canvas-simplification`, with legacy memory code. Its top-level CLAUDE.md routes to the runtime; most older README/ROADMAP detail is historical.
- Read the runtime `README.md`, `CLAUDE.md`, and `docs/codebase-map.md` for current behavior.
- `src/memory-reader.js`: current-state and historical selectors; keyword search; stable fact keys; existing source refs and memory hashes. Ordinary recall is deterministic and local.
- `src/promote-memories.js`: human review for new current state, exact predecessor checks, current-value conflict detection, atomic supersession and append. Existing bodies/hashes/anchors/source refs remain intact.
- `src/memory-proposals.js`: existing review queue, shared lock and buffers. Reuse it; do not invent another fact-approval queue.
- `src/memory-extractor.js`: currently source text/transcript to durable-memory candidates; model calls are bounded; imported text is treated as data. Source refs may lack a verifiable excerpt or have an unavailable source; do not invent provenance.
- `scripts/daily-sweep.js`: serial scan of changed recent Claude transcripts and top-level inbox Markdown, mtime ledger, per-source retry. New ingestion must not recursively ingest its own generated output.
- `src/vault-gateway.js` and `src/content-policy.js`: current path and exclusion enforcement. Extend existing contracts instead of bypassing them for binary imports or derived writes.
- `scripts/run-scheduled.js`: verifies detached HEAD against a pinned revision and rejects changed runtime code/configuration. Live `state/` and `.env` are shared symlinks; a development worktree must use isolated state and fixtures, never inherit these symlinks.
- Four command definitions forward to the runtime; any new commands need explicit wrapper and documentation integration there. CLI examples for new commands must be marked proposed/unimplemented.

## Required design decisions

- Keep the human-authored LEFT canon and existing authority hierarchy. Reviewed current memory governs operational facts. A source claim or model analysis cannot override a current fact merely by being newer or highly ranked.
- Generated project pages/answers are derived Markdown views in existing allowed vault folders. Carry explicit origin/type, supporting memory hashes/source versions, generated/review dates, and stale indicators. Do not change memory hashes to attach new metadata.
- Evidence locators must bind to source versions and exact passages: Markdown anchors/line excerpts, transcript message locator, PDF page, DOCX paragraph/heading, web snapshot section. Missing evidence must be visible; legacy source pointers remain valid pointers, not falsely verified citations.
- Source-changed/source-missing is distinct from fact-false. Flag affected views and review needs; never erase canonical history or auto-retire an approved fact.
- Generated pages and saved answers cannot automatically enter memory capture, source import, or review as independent corroboration. Explicit future promotion traces back to original evidence and still needs current-fact review.
- Review actions must show and validate the exact proposal revision and current predecessor under the existing lock; stale review submissions refresh instead of overwriting a newer decision. Candidate text edits invalidate prior acceptance.
- Project scopes must include explicit source paths and selected shared facts, not whole-machine scans. Project purpose guides retrieval relevance, not factual authority. Default fact-key lookup and history behavior stay exact.
- All additions work without embeddings. Optional semantic retrieval is deferred until measured against frozen baseline and a separate project/source benchmark; no new provider is assumed.
- Add AI synthesis on explicit user requests and a bounded, approved incremental refresh route; avoid per-query whole-vault regeneration. Record usage counts without persisting query text by default. Failed refresh preserves last valid output but labels its dependency state.
- New source intake copies only explicitly selected documents/URLs; originals are retained. Content hashes and parser versions define idempotence. Bounded parsers preserve page/paragraph locations; scanned/encrypted/corrupt files have explicit outcomes. OCR may be a separately scoped follow-up, not silently reported successful.
- Keep source extraction, retrieval, generation and publication status distinct. URLs must not execute scripts or fetch local/private endpoints; fetched content must not become tool instructions.

## Acceptance and delivery expectations

- Phase 0: development worktree based on the runtime revision, isolated fixtures/state, preservation baseline and contracts. Do not implement against the legacy development checkout.
- Map all six capabilities to phases; a dependency-driven execution order may differ from value priority.
- Include concrete failure and concurrency acceptance for evidence changes, old review submissions, stale derived pages, duplicate ingest, feedback loops, unavailable models, and current/history recall.
- Preserve the frozen 20-question eval and baseline. The current README reports 18/20 frozen/history and 14/20 current-only live because four expected records were superseded; these are documented prior results, not tests rerun for this plan. Re-establish baselines during implementation and never alter history semantics to chase a score.
- Add a separate benchmark with paraphrases, cross-document questions, source locators, unanswerable questions and conflicts. Require zero lifecycle/authority regressions, no regressions on previously passing frozen queries, resolvable citations, and explicit abstention on conflicting/missing evidence.
- End-to-end story: import a project source, inspect evidence, review a proposed fact, refresh the project page, ask with project purpose, save the cited answer, update the source, observe stale/needs-review labels while current approved memory persists, then approve its successor and refresh all dependent views.
- Describe feature flags, phased rollout, isolated pilot, and rollback. Live activation/pin/schedule/vault changes are a later explicit approval after a concrete tested release is prepared. Code-only rollback must not restore old memory/state over newer accepted writes.
- No automatic research, new desktop app, standalone graph interface, bulk memory migration, second memory system, or changes to Agent Canvas.

## External reference

[LLM Wiki documented feature set](https://github.com/nashsu/llm_wiki#features), reviewed 2026-09-14. It supplies inspiration for linked summaries, source-grounded answers, asynchronous review, document intake, purpose context and saved answers. The proposed architecture and acceptance criteria here are specific to Second Brain. No upstream application was installed or run, and its performance claims are not a Second Brain baseline.

## Planning workflow note

The GSD CLI's parent-project heuristic selected `/Users/cpconnor/projects` despite this repository's own `.planning/ROADMAP.md`. Initialization was performed through its existing `cmdInitQuick` function with the exact repository root; it confirmed roadmap/planning availability. No GSD configuration or tool code was changed. Planning artifacts belong only in this repository's task directory.
