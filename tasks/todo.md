# Todo

## Current
- [x] Execute Phase 2: Content Pipeline (461 tests passing, cross-AI reviewed PASS)
- [x] Phase 3 discuss-phase (22 decisions, D-01..D-22, PR #5 merged)
- [ ] Phase 3 context refinements (linter upgrades on chore/phase3-context-refinements — merge pending)
- [ ] Phase 3 cross-AI review (Gemini CLI needs re-auth first)
- [ ] Phase 3 plan-phase (`/gsd:plan-phase 3`)

## Session Handoff (Session 15 → Next)
- Merge `chore/phase3-context-refinements` (1 commit: D-02 API-omission rewrite, D-06 Keychain, D-09/D-10 VIP filter clarification, D-15 SOURCE enum, D-23 connectors.json config)
- Re-auth Gemini CLI: `gemini auth login` (flagged since session 4)
- Cross-AI review of 03-CONTEXT.md with Gemini
- Then `/gsd:plan-phase 3` to create execution plans for External Integrations

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
