# Todo

## Current
- [ ] `/gsd:discuss-phase 6` or `/gsd:plan-phase 6` — Defect Fixes and UAT (8 requirements: FIX-01 through FIX-05, UAT-01/02/03)

## Session Handoff (Session 28 — 2026-04-23)
- Phase 5 (Integration Wiring) fully complete — 3/3 plans, all INTEG requirements satisfied
- RemoteTrigger `trig_01KvxeDfYDAEwAzw9zw9DKKB` created and verified firing
- Trigger fires with expected degradation: Calendar/Gmail/GitHub MCP unavailable in remote, Haiku API key missing, path mismatch
- Three new FIX requirements filed for Phase 6: FIX-03 (MCP connector consumption), FIX-04 (Haiku key handling), FIX-05 (path normalization)
- Cleaned up all checkpoint files (HANDOFF.json, .continue-here files)
- Branch: chore/session-24-wrap
- Next session: plan Phase 6 — 8 requirements spanning defect fixes + remote execution refinements + UAT

## Followup
- [ ] **DEFECT (LOW): in-batch dedup gap in src/promote-memories.js:330-338** — two proposals with identical contentHash in the same promotion batch can both promote. Fix: track Set of promoted hashes inside batch loop + add test. (FIX-01)
- [ ] **DEFECT: Config hot-reload not firing — fs.watch broken or cache not invalidating.** Workaround: restart Node process after config edits. (FIX-02)
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
