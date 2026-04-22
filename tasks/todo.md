# Todo

## Current
- [x] Execute Phase 2: Content Pipeline (461 tests passing, cross-AI reviewed PASS)
- [x] Phase 3 discuss-phase (22 decisions, D-01..D-22, PR #5 merged)
- [x] Phase 3 context refinements — PR #6 squash-merged (c6736ea), branch deleted
- [x] Consolidated cross-AI review (Gemini + Codex) of 03-CONTEXT.md + 4 plan files — PR #8 merged (db5f622), gate PASS
- [x] Phase 3 plan-phase — 4 plans, 2 waves, verification 8/8 PASSED
- [x] gmail-mcp-pete repo scaffolded (UsernameTron/gmail-mcp-pete) — 3 stub tools, pushed
- [x] Deploy agent ecosystem (4 agents: vault-guardian, code-writer, test-writer, codebase-scout) — skipped, executed without agents
- [x] `/gsd:execute-phase 3` — External Integrations (4/4 plans, 478 tests, verification 9/9 PASSED)
- [x] Ship Phase 3 — PR #10 merged (50f438f), chore/phase3-complete branch deleted
- [x] `/gsd:discuss-phase 4` — 22 decisions locked, scheduling verified via RemoteTrigger probe
- [ ] `/gsd:plan-phase 4` — Daily Briefing & Scheduling
- [ ] Delete test trigger trig_01NHx3Uz8ni8eZSfsMph4miY at https://claude.ai/code/scheduled

## Session Handoff (Session 20 — 2026-04-22)
- Phase 3 shipped: PR #10 merged (50f438f), chore/phase3-complete branch deleted, local master rebased to origin
- Phase 4 discuss-phase complete: 22 decisions (D-01..D-22) locked in 04-CONTEXT.md
- Scheduling verified: RemoteTrigger API probed — standard 5-field cron in UTC, `environment_id` required, `mcp_connections` for Google Calendar available. Test trigger created (disabled) and needs manual deletion.
- Gmail scope resolved: out-of-scope for Phase 4, parallel workstream. Phase 4 uses interface contract; works with stubs.
- Two previously-flagged blockers dissolved: scheduled task syntax verified, gmail-mcp-pete scoped out
- Key decisions: dual-surface output (vault note + terminal), decay-rate section ordering, 2 Haiku calls max, inline slippage scanner (7-day threshold), always-run synthesis with diagnostic fallback, grep-friendly error format
- Branch: master (clean)
- Next session: `/gsd:plan-phase 4` — then execute. Delete test trigger first.

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
