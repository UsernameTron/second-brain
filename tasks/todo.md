# Todo

## Current
- [ ] `/gsd:execute-phase 5` — execute Integration Wiring (3 plans, 2 waves)
- [ ] Delete test trigger trig_01NHx3Uz8ni8eZSfsMph4miY at https://claude.ai/code/scheduled (needed before Plan 05-03)

## Session Handoff (Session 25 — 2026-04-22)
- Phase 5 plan-phase completed: 3 plans, 2 waves, checker passed after 1 revision
- Wave 1 (parallel): 05-01 Gmail OAuth bootstrap + wire stubs, 05-02 Excluded terms expansion + substring matching
- Wave 2 (sequential): 05-03 RemoteTrigger activation (delete test, create real, verify fire)
- Human checkpoints in plans: OAuth browser consent (05-01), provide excluded terms list (05-02), delete test trigger + verify fire (05-03)
- Planner found: content-policy.js uses word-boundary regex (needs fix to substring), classifier.js has silent parsing bug (Phase 6), tool schema missing hours param
- Branch: chore/session-24-wrap
- Next session: `/gsd:execute-phase 5`

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
- [x] Phase 5 discuss-phase complete (12 decisions locked, 05-CONTEXT.md)
- [x] Phase 5 plan-phase complete (3 plans, 2 waves, checker passed after revision)
