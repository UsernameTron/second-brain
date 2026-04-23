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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~20 | 4 | Initial GSD adoption — full discuss/plan/execute/verify pipeline |
| v1.1 | ~13 | 3 | UAT with real APIs, CI pipeline, branch hygiene discipline |

### Cumulative Quality

| Milestone | Tests | Requirements | LOC |
|-----------|-------|-------------|-----|
| v1.0 | 502 | 21/21 | ~7K |
| v1.1 | 547+ | 32/33 | ~17K |

### Top Lessons (Verified Across Milestones)

1. Zero-trust permissions from day one �� retrofitting security is always more expensive
2. Uniform result shapes across connectors eliminate integration-time surprises
3. Non-blocking enrichment stages let pipelines degrade gracefully instead of failing entirely
4. Update traceability artifacts as work completes — stale tracking creates false signals at gate checks
5. Squash-merge PRs require local master sync after each merge — accumulating divergence compounds reconciliation cost
