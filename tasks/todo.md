# Todo

## Current
- [ ] `/gsd:plan-phase 6` — Defect Fixes and UAT (7 requirements: FIX-01, FIX-03/04/05, UAT-01/02/03)

## Session Handoff (Session 29 — 2026-04-22)
- Phase 6 context gathered — 06-CONTEXT.md with 9 decisions locked
- FIX-02 (config hot-reload) deferred to backlog — no real symptom, two mechanisms already implemented
- Phase 6 scope narrowed to 7 requirements (was 8)
- Key design: Calendar MUST work remotely (detect attached MCP connector), everything else degrades cleanly
- UAT uses synthetic test inputs (not real captures from Pete's workflow)
- Dedup fix: within-batch Set + check proposals file
- Branch: chore/session-24-wrap
- Next session: `/gsd:plan-phase 6`

## Followup
- [ ] **DEFECT (LOW): in-batch dedup gap in src/promote-memories.js:330-338** — two proposals with identical contentHash in the same promotion batch can both promote. Fix: track Set of promoted hashes inside batch loop + add test. (FIX-01)
- [ ] **DEFERRED: Config hot-reload (FIX-02)** — no real symptom observed, two mechanisms already in place. Revisit if a symptom surfaces.
- [ ] **DEFECT: Remote execution — today-command.js doesn't consume MCP connectors in remote trigger context.** Calendar connector attached but unused. (FIX-03)
- [ ] **DEFECT: Remote execution — missing Haiku API key causes classification failure in remote env.** Need graceful fallback. (FIX-04)
- [ ] **DEFECT: Remote execution — path mismatch /root vs /Users/cpconnor.** Need path normalization for local vs remote. (FIX-05)
- [ ] UAT pending: LLM classification accuracy spot-check on real captures (UAT-01)
- [ ] UAT pending: wikilink relevance review against memory.md output (UAT-02)
- [ ] UAT pending: Obsidian UX walkthrough for capture → promote flow (UAT-03)

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
- [x] Phase 5 execution complete (3/3 plans, INTEG-01/02/03 satisfied, RemoteTrigger verified)
