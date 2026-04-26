# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-04-22
**Phases:** 4 | **Plans:** 15 | **Tests:** 502 | **Requirements:** 21/21

### What Was Built
- Write-permission vault boundary with three-gate write pipeline (ingress filter, content filter, style lint)
- `/new` input routing: two-stage LLM classifier, domain-based left/right enforcement, wikilink suggestions
- Memory compounding pipeline: session extraction, proposals staging, human-reviewed promotion, dead-letter lifecycle
- Gmail, Calendar, GitHub MCP connectors with zero-trust permissions
- `/today` daily briefing: 6 sections, cross-project slippage, frog identification, graceful degradation
- RemoteTrigger scheduling config for pre-morning automation

### What Worked
- Phase-by-phase execution kept scope manageable — each phase delivered a complete capability
- Zero-trust permission design from the start avoided security retrofits
- Contract tests (24 for /today alone) caught integration issues early
- GSD framework provided clear planning-to-execution pipeline with minimal ceremony
- Left/right write-permission split proved to be the right architectural foundation — every subsequent feature built cleanly on it
- Promise.allSettled pattern for fan-out data gathering gave graceful degradation for free

### What Was Inefficient
- Phase 3 SUMMARY one-liners were corrupted by lesson-capture formatting — raw "Rule 1 - Bug" entries leaked into milestone archive
- gmail-mcp-pete was scaffolded but OAuth never wired — should have been identified as a blocker earlier or explicitly deferred
- Some tests relied on jest.mock factory patterns that broke under Jest 30 — migration cost that could have been avoided by adopting jest.doMock earlier
- Excluded terms limited to 3 seeds — expansion should have been part of Phase 1, not deferred

### Patterns Established
- `makeResult()` / `makeError()` uniform result shape across all connectors
- LLM classify() never-throws contract — returns structured result with failureMode
- Dead-letter quarantine with bounded auto-retry (3 attempts, 15-min interval, freeze after cap)
- Wikilink enrichment as non-blocking pipeline stage
- Config-driven pipeline with hot-reload capability (despite current defect)
- Correlation IDs for tracing content through multi-stage pipelines

### Key Lessons
1. One-liner extraction from SUMMARY.md files needs curation — raw CLI output includes noise from lesson-capture formatting
2. OAuth integration should be wired or explicitly descoped during planning, not left as stubs that suggest functionality
3. jest.doMock is preferred over jest.mock when mock factories need dynamic configuration — avoids hoisting bugs
4. chokidar v3 (not v5) for CJS projects — v5 is ESM-only
5. Client-side time-window filtering is acceptable when MCP tools lack server-side parameters (GitHub list_pull_requests)

### Cost Observations
- Model mix: predominantly Opus for orchestration, Sonnet for subagents, Haiku for classification
- Sessions: ~20 sessions across 2 days
- Notable: 92 commits, 130 files, ~7K source LOC — high velocity enabled by GSD parallel execution

---

## Milestone: v1.1 — Go Live

**Shipped:** 2026-04-23
**Phases:** 3 (05-07) | **Plans:** 7 | **Requirements:** 11/12 (1 deferred)

### What Was Built
- Gmail OAuth fully wired — googleapis live calls with Keychain-backed OAuth2, replacing all stubs
- Excluded terms expanded from 3 to 15 with substring matching (single toLowerCase, catches embedded variants)
- RemoteTrigger activated on weekday cron for pre-morning `/today` execution
- In-batch dedup fixed (3 sub-bugs: self-match, missing content_hash, non-pending re-processing)
- Remote execution hardened — calendar MCP connector, env-var path resolution, Haiku API graceful degradation
- GitHub Actions CI pipeline — Node 20+22 matrix, push + PR triggers, README badge

### What Worked
- Phase 6 UAT with real Anthropic API calls caught issues that stubs would have missed
- GSD subagent parallelization kept main context clean during multi-bug fixing
- Bug decomposition (FIX-01 → 3 sub-bugs) prevented half-fixes
- Making repo public resolved CI billing issue — pragmatic decision that unblocked the milestone
- Branch cleanup at milestone end keeps git history navigable

### What Was Inefficient
- REQUIREMENTS.md checkboxes weren't updated when work was completed — traceability table showed "Pending" for delivered items
- Phase 7 was marked incomplete in ROADMAP.md progress table despite being done (checkbox vs table inconsistency)
- Local master diverged from remote (62 granular commits vs squash-merged PRs) — required manual reconciliation at session boundary
- FIX-02 (config hot-reload) investigation was started but never produced a root cause — should have been descoped earlier

### Patterns Established
- AUTH_ERRORS structural comparison (errorType field, not string matching)
- Env-var overrides for path resolution across local/remote execution contexts
- UAT harnesses that call real LLM APIs for accuracy validation (excluded from CI, run on-demand)

### Key Lessons
1. Update REQUIREMENTS.md traceability table as work completes — stale checkboxes create false signals at milestone closure
2. Squash-merge PRs create history divergence if local branches accumulate — merge or reset local master after each PR
3. Bugs with vague reproduction steps (FIX-02) should be descoped to backlog early, not carried as "pending"
4. RemoteTrigger API uses nested `job_config.ccr` structure — not flat fields (caught via trial-and-error)

### Cost Observations
- Model mix: Opus for orchestration and UAT, Sonnet for subagents, Haiku for classification
- Sessions: ~13 sessions across 2 days
- Notable: 7 plans executed in 2 days — high velocity from established codebase patterns

---

## Milestone: v1.3 — Review Remediation

**Shipped:** 2026-04-24
**Phases:** 5 (12-16) | **Commits:** 11 | **PRs merged:** #22, #24, #26, #27, #29

### What Was Built

- Phase 12 — Critical safety fixes: 7 HIGH/MEDIUM findings closed (vault-gateway bypass, config crash paths, classifyLocal fetch timeout, LLM fallback hardening, security-scan-gate repaired with tri-state exit codes)
- Phase 13 — Config schema gaps: 3 new schemas (vault-paths, excluded-terms, scheduling), AJV error fix, every loader on loadConfigWithOverlay
- Phase 14 — CI hardening: ESLint flat config (53 violations fixed in one pass), CodeQL SAST, license-checker, UAT skip guard for CI
- Phase 15 — Architecture refactor: today-command.js 727 LOC → 230 LOC orchestrator + 4 extracted single-responsibility modules; new-command deduplicated against classifier.classifyInput; vault-gateway re-exports removed; memory-proposals locks privatized
- Phase 16 — Test quality lift: 114 new tests (662 → 776), branch coverage 75.35% → 81.31% under CI env, CI threshold ratcheted 70% → 80%, hook test harnesses for auto-test.sh and protected-file-guard.sh, classifier integration test suite

### What Worked

- **Cross-AI audit fed a concrete backlog.** The v1.2 cross-reviewer synthesis (Claude native + Gemini + Opus 4.6) produced 18 specific findings that became the v1.3 scope directly. No guessing about what to fix.
- **Parallel phase workstreams shipped independently.** Phases 13 and 14 both landed before 15/16 started, unblocking the dependency chain without serial waiting.
- **In-phase ratchet protects the ratchet itself.** Moving the CI branch threshold from 70% to 80% *in the same PR* that added the coverage to justify it meant the PR couldn't regress its own gain. Contrast: deferring the ratchet to milestone-close would have allowed any subsequent PR to silently drop below the target.
- **Behavior-preserving refactor caught by tests.** The today-command decomposition tripped an error-resilience test when I made config-missing degrade gracefully instead of crashing. The test caught the drift immediately — spent maybe 2 minutes reverting vs. what would have been a production incident.
- **Hybrid mock-reduction strategy.** Instead of rewriting 17 existing classifier unit tests, added a new integration suite alongside. Preserved fast unit feedback, gained integration confidence, lower rewrite risk.

### What Was Inefficient

- **Scope-doc targets ≠ data-driven targets.** The Phase 16 scope doc named classifier.js as the coverage target (65% branches). The actual bottlenecks were memory-proposals (57%) and memory-extractor (60%). Reading the coverage report BEFORE writing tests would have saved a pass of analysis.
- **Local vs CI coverage gap.** First Phase 16 CI run reported 79.95% — just under threshold — because CI skips UAT. Local measured 80.32% WITH UAT paths. Required a second commit adding CI-reachable tests. Should have verified under `CI=true` locally before pushing.
- **Stale v1.2 REQUIREMENTS.md left in root.** The v1.2 milestone-close ceremony skipped archival of REQUIREMENTS.md — it sat at repo root until the v1.3 ceremony moved it. Adding a gate in the complete-milestone workflow to always move REQUIREMENTS.md would have caught this.

### Patterns Established

- **Safety-margin commits.** When a CI gate lands near the threshold, add a targeted commit that pushes coverage up 1%+ above the bar. Keeps the threshold stable against small future reverts.
- **Hybrid mock layers.** Unit tests mock at the stage/function boundary; integration tests mock only the external dependency (LLM client, MCP server, filesystem). Keep both. The unit tests give fast feedback on logic; the integration tests catch wiring bugs.
- **Decomposition preserves behavior, tests prove it.** Any god-module refactor must keep its existing integration test suite passing verbatim. Don't "refactor and rewrite tests" in the same PR — the tests are the spec.
- **In-phase CI ratchet.** When a phase lifts a quality bar, ratchet the CI gate in the same PR. The PR's own work justifies the new bar; the new bar prevents the PR itself from regressing.

### Key Lessons

- **Read the coverage report before writing tests.** Data beats scope docs for prioritizing what to cover.
- **Run the CI command locally with `CI=true`** before pushing — CI skips UAT and other guarded suites, so local measurements without that flag are optimistic.
- **Privatize via `_testOnly` namespace.** When a function needs to be internal but still testable directly, `module.exports._testOnly = { ... }` keeps the public API clean without dropping test coverage.
- **"Already upstream" rebase is free.** When Phase N depends on Phase N-1 and both are in-flight, branch Phase N off Phase N-1's branch. After Phase N-1 merges, `git rebase master` drops the Phase N-1 commits automatically and leaves Phase N cleanly rebased.

### Cost Observations

- Model mix estimate: 60% Opus 4.6 (orchestration, planning, execution), 40% Sonnet/Haiku (subagent work like planner/verifier/codebase-mapper)
- Sessions: 3 primary sessions over 2 days (Phase 12-14 day 1; Phases 15-16 + milestone close day 2)
- Notable: Phase 15 refactor was a single-session execution despite touching 8 source files + 2 test files. The per-commit validation loop (write module → run tests → commit) prevented any single failure from cascading.

---

## Milestone: v1.4 — Memory Activation & Final Closeout

**Shipped:** 2026-04-26 (tag v1.4)
**Phases:** 5 (17, 18, 19, 20, 21) | **Plans:** 23 | **Files changed:** 114 (+21,393 / −138)
**PRs merged:** #25–#48 | **Audit:** tech_debt (Option C)

### What Was Built

- **Phase 17** UAT CI infrastructure: weekly cron + manual workflow_dispatch, step-level secret isolation, 90-day artifact retention, branch protection on master with PR-required-reviews + force-push block
- **Phase 18** Memory Retrieval Foundation: `/recall <query>` keyword search via minisearch (AND, phrase, negation, `--category`/`--since`/`--top N`), Memory Echo section in `/today` at 0.65 threshold
- **Phase 19** Semantic Memory Search: Voyage AI `voyage-4-lite` embed-on-promotion sidecar, `semanticSearch` with cosine + temporal decay (calibrated 0.55 threshold post-UAT), `/recall --hybrid` RRF fusion, Pattern 7 graceful degradation (3-failure / 15-min cross-invocation window)
- **Phase 20** Value Extraction Instrumentation: per-day `RIGHT/daily-stats.md` row (8 columns, idempotent same-day update), per-connector + per-operation latency capture, verbatim "Yesterday: +N proposals…" summary line at top of `/today`
- **Phase 21** Closeout Hygiene: 0 ESLint no-console warnings (35 category-tagged disables), JSDoc on 53 public exports, 45 Unicode `test.todo` markers staged for v1.5 HYG-UNICODE-02, all 8 living docs synced

### What Worked

- **Manifest-first protocol on scoped governance work** (Plan 21-03 caught 5 categorization corrections from CONTEXT estimates — ~16% of the 32-site corpus). Codified as LESSON-MANIFEST-FIRST-VALIDATED-01.
- **Live-recount at Task 1 of doc-refresh plans** (Plan 21-04 captured 1127 tests / 81.28% branch / 9617 LOC at execution start; downstream tasks referenced the capture, not stale CONTEXT figures). Codified as LESSON-LIVE-RECOUNT-AT-EXECUTE-01.
- **Option A scope correction over scope limitation** when audit gates fail on adjacent pre-existing artifacts in same Lock-class (Plan 21-03 absorbed 3 bare disables from promote-memories.js + semantic-index.js as corollary). Codified as LESSON-OPTION-A-SCOPE-CORRECTION-01.
- **Closeout phases default to absorbing adjacent pre-existing debt** rather than deferring (corollary disables, bonus REQ flips). Codified as LESSON-PRE-EXISTING-DEBT-ABSORPTION-01.
- **Calibrate against live system, not against spec** (Phase 19 threshold 0.72 → 0.55 after first live UAT showed top relevance hits in 0.55-0.70 cosine band; spec was based on older voyage-3 family math).
- **Audit-then-remediate (Option C) over hand-wave-and-ship**: PR #47 audit produced 18/19-SATISFIED + 1-PARTIAL with file:line evidence; PR #48 closed the partial in 5 minutes; remaining process drift documented in MILESTONES.md `### Known Gaps` rather than silently accepted.

### What Was Inefficient

- **Phase 21 shipped without a phase-level VERIFICATION.md** — per-plan SUMMARYs each had A1-A7 acceptance gates but the consolidated phase verification step was skipped. Audit substituted, but the structural gap is real.
- **REQUIREMENTS.md per-phase checklist drift** — Plan 21-04 closed Phase 18 + Phase 20 traceability rows but missed flipping the per-phase checklist `[ ]` → `[x]` at the top of REQUIREMENTS.md for Phase 18 (4 entries) and Phase 20 (2 entries). Same drift LESSON-LIVE-RECOUNT-AT-EXECUTE-01 was meant to prevent — except this was *within* a single file rather than across files.
- **Two false-positive STOP-and-stash detours during v1.4 Phase 21 pre-flight** — recipes that prescribed additive changes ("add X to file Y") executed without first reading the target to confirm X wasn't already there. Codified as LESSON-RECIPE-VERIFY-01.
- **One trip-wire over-strict gate** — pre-flight CHECK 2 fired on UAT-01 (a pre-existing local-only failure) during the dotenv-fix verification; the fix itself was sound but the absolute "0 failed" gate forced unnecessary remediation. Codified as LESSON-TRIP-WIRE-RELATIVE-01.

### Patterns Established

- **Lock fence verification as commit-time gate** — `git diff master -- src/` returning empty (or only comment-line changes) is the structural proof that hygiene work didn't touch function bodies. Held across HYG-JSDOC-01 and HYG-CONSOLE-01.
- **Path B for unsolvable-in-this-milestone work** — D-LOCK-5-AMEND-A established the pattern: stage `test.todo()` markers documenting the gap rather than asserting behavior the implementation cannot deliver, then defer the implementation work to the next milestone with explicit handoff (HYG-UNICODE-02 in tasks/todo.md).
- **Hybrid audit verdict (tech_debt)** — surfaces partials and process gaps without forcing them to either pass or fail. Pairs naturally with three-option routing (close gaps / absorb / hybrid).
- **`CI=true npm test` as the green/red signal** for this project — UAT skip-guard semantics make bare `npm test` a developer-environment debugging mode, not a CI signal. Codified as LESSON-PREFLIGHT-CI-MODE-01.

### Key Lessons (full inventory in tasks/lessons.md)

1. **LESSON-LIVE-RECOUNT-AT-EXECUTE-01** — Task 1 of any doc-refresh plan re-counts live values; downstream tasks reference the capture, never CONTEXT estimates
2. **LESSON-MANIFEST-FIRST-VALIDATED-01** — Any plan whose scope is "apply label X to N items" gets a Task 0 that builds the full N-row manifest and pauses for review
3. **LESSON-OPTION-A-SCOPE-CORRECTION-01** — When audit gate fails on adjacent pre-existing artifact in same Lock-class, default to absorption ("32 primary + 3 corollary") over exemption
4. **LESSON-BONUS-REQ-FLIP-01** — "Verifiable v1.4-fact error" rule legitimately permits adjacent-scope corrections beyond the named target rows; document scope expansions explicitly in SUMMARY
5. **LESSON-PRE-EXISTING-DEBT-ABSORPTION-01** — Closeout phases default to absorbing adjacent pre-existing debt; reserve deferral for genuine future-milestone work
6. **LESSON-RECIPE-VERIFY-01** — Recipes that prescribe additive changes must include a Step 0 that reads the target file and confirms the change isn't already present
7. **LESSON-TRIP-WIRE-RELATIVE-01** — Recipe verification trip-wires baseline against most recent known state, not against a Platonic 0-failure ideal
8. **LESSON-SQUASH-CONTENT-CHECK-01** — Use `git cherry-pick --no-commit` + `git status --porcelain` to verify squash-merged branch content equivalence
9. **LESSON-PREFLIGHT-CI-MODE-01** — `CI=true npm test` is the production-correctness signal; bare `npm test` is developer-mode debugging
10. **LESSON-UAT-CORPUS-DRIFT-01** — Classifier-side changes must include UAT-corpus revalidation step

### Cost Observations

- **Model mix estimate:** 70% Opus 4.6 (orchestration, planning, execution); 30% Sonnet (subagent work — verifier, integration auditor, codebase mapper, planner)
- **Sessions:** ~12 primary sessions over 3 days
- **Notable:** Phase 19 (Semantic Memory Search) was the most concentrated single-phase effort — 5 plans, ~50% of v1.4 commits, ended with empirical UAT calibration that shifted spec'd 0.72 → 0.55. The discuss-phase pre-research (4 parallel agents on Voyage embeddings + vector indexing for markdown corpora) prevented architecture rework during execution.
- **Phase 21 shipped 5 PRs in <24 hours** (PRs #42-#46) — manifest-first protocol + Lock 5 fence discipline made the closeout work mechanical rather than adventurous.
- **Audit cycle (PRs #47-#48) added ~1 hour** to milestone close but produced explicit gap inventory and closed the only user-facing partial — net positive.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~20 | 4 | Initial GSD adoption — full discuss/plan/execute/verify pipeline |
| v1.1 | ~13 | 3 | UAT with real APIs, CI pipeline, branch hygiene discipline |
| v1.2 | — | 4 | Hook ecosystem, security scanner agent, local LLM routing, context7 MCP |
| v1.3 | 3 | 5 | Cross-AI audit-driven backlog, parallel phase workstreams, in-phase CI ratchet, hybrid mock reduction |
| v1.4 | ~12 | 5 | Memory layer activation (read path), manifest-first governance, Path B for unsolvable-in-milestone work, audit-then-remediate (Option C) |

### Cumulative Quality

| Milestone | Tests | Requirements | LOC | Branch Coverage |
|-----------|-------|-------------|-----|-----------------|
| v1.0 | 502 | 21/21 | ~7K | — |
| v1.1 | 547+ | 32/33 | ~17K | — |
| v1.2 | 662 | 11/11 | ~19K | 73.77% (threshold 70%) |
| v1.3 | 776 | 15/18 backlog (3 LOW deferred) | ~19K | 81.31% under CI (threshold 80%) |
| v1.4 | 1127 (1044 + 38 skipped + 45 todo) | 19/19 mapped (18 SATISFIED + 1 PARTIAL closed in PR #48) | 9.6K (src/ only; ~21K total) | 81.28% (threshold 80%) |

### Top Lessons (Verified Across Milestones)

1. Zero-trust permissions from day one �� retrofitting security is always more expensive
2. Uniform result shapes across connectors eliminate integration-time surprises
3. Non-blocking enrichment stages let pipelines degrade gracefully instead of failing entirely
4. Update traceability artifacts as work completes — stale tracking creates false signals at gate checks
5. Squash-merge PRs require local master sync after each merge — accumulating divergence compounds reconciliation cost
6. Manifest-first protocol catches ~15% drift in scoped governance work (v1.4 Plan 21-03) — make the manifest, validate it, *then* apply
7. `CI=true npm test` is the production-correctness signal in projects with describe.skip CI guards — bare `npm test` is developer-mode debugging
8. Path B for unsolvable-in-this-milestone work: stage `test.todo()` markers documenting the gap rather than asserting behavior the implementation cannot deliver, with explicit handoff to the next milestone
