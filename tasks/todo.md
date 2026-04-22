# Todo

## Current
- [x] Execute Phase 2: Content Pipeline (461 tests passing, cross-AI reviewed PASS)
- [x] Phase 3 discuss-phase (22 decisions, D-01..D-22, PR #5 merged)
- [x] Phase 3 context refinements — PR #6 squash-merged (c6736ea), branch deleted
- [ ] Consolidated cross-AI review (Gemini + Codex) of 03-CONTEXT.md + 4 plan files
- [x] Phase 3 plan-phase — 4 plans, 2 waves, verification 8/8 PASSED

## Session Wrap (Session 16 — 2026-04-22)
- PR #6 squash-merged to master (c6736ea), branch chore/phase3-context-refinements deleted, local master clean
- Plan files created:
  - `.planning/phases/03-external-integrations/03-01-PLAN.md` — 297 lines (shared foundation: SOURCE enum, makeResult/makeError, config + schema, test helpers)
  - `.planning/phases/03-external-integrations/03-02-PLAN.md` — 198 lines (Calendar connector, Cowork MCP wrapper)
  - `.planning/phases/03-external-integrations/03-03-PLAN.md` — 214 lines (Gmail connector, gmail-mcp-pete MCP)
  - `.planning/phases/03-external-integrations/03-04-PLAN.md` — 188 lines (GitHub connector, Docker MCP wrapper)
- Ship log: PR #1 (Phase 1), PR #2 (Phase 2), PR #5 (Phase 3 discuss), PR #6 (Phase 3 context refinements)
- Ready for consolidated cross-AI review. Next session picks up with /prime → review prompt.

## Followup
- [ ] **DEFECT (LOW): in-batch dedup gap in src/promote-memories.js:330-338** — two proposals with identical contentHash in the same promotion batch can both promote. Fix: track Set of promoted hashes inside batch loop + add test. Surfaced by Gemini + host-session review of Phase 2.
- [ ] UAT pending: LLM classification accuracy spot-check on real captures
- [ ] UAT pending: wikilink relevance review against memory.md output
- [ ] UAT pending: Obsidian UX walkthrough for capture → promote flow
- [ ] **DEFECT: Config hot-reload not firing — fs.watch broken or cache not invalidating.** Workaround: restart Node process after config edits. Debug in dedicated session.
- [ ] **Expand excluded-terms.json to 15-20 entries before v1 go-live** — Categories: former employer product names, project codenames, client names, internal tools, senior leadership names. Currently 3 seed entries (ISPN, Genesys, Asana).

## Completed
- [x] Deep questioning and PROJECT.md creation
- [x] Config setup (YOLO, coarse, quality models)
- [x] Domain research (4 parallel researchers: stack, features, architecture, pitfalls)
- [x] Research synthesis (SUMMARY.md)
- [x] Requirements definition (21 v1 requirements across 7 categories)
- [x] Roadmap creation (4 phases, 21/21 requirements mapped)
- [x] CLAUDE.md generated with GSD workflow guidance
- [x] Phase 1 context gathering (16 decisions)
- [x] Phase 1 research (564-line RESEARCH.md)
- [x] Phase 1 planning (2 plans, 2 waves)
- [x] Phase 1 cross-AI review (Codex — 5 HIGH concerns)
- [x] Phase 1 plan revision (all concerns addressed, verified)
- [x] Execute Phase 1: Vault Foundation (`/gsd:execute-phase 1`)
- [x] Phase 2 context gathering (68 decisions, D-01..D-68)
- [x] Phase 2 cross-AI context review (Codex + host session, 5 CRITICAL resolved)
- [x] Phase 2 planning (6 plans, 3 waves, checker PASSED)
- [x] Execute Phase 2: Content Pipeline (6/6 plans, 461 tests, 24 suites)
- [x] Phase 2 verification (gsd-verifier 6/6 must-haves PASSED)
- [x] Phase 2 post-execution code review (Gemini + host session, PASS)
- [x] Phase 3 discuss-phase complete (22 decisions, 4 areas, PR #5)
- [x] Phase 3 context refinements merged (PR #6, 6 patches from Gemini round 1)
- [x] Phase 3 plan-phase complete (4 plans, 2 waves, 897 total lines)
