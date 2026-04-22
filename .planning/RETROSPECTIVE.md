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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~20 | 4 | Initial GSD adoption — full discuss/plan/execute/verify pipeline |

### Cumulative Quality

| Milestone | Tests | Requirements | LOC |
|-----------|-------|-------------|-----|
| v1.0 | 502 | 21/21 | ~7K |

### Top Lessons (Verified Across Milestones)

1. Zero-trust permissions from day one — retrofitting security is always more expensive
2. Uniform result shapes across connectors eliminate integration-time surprises
3. Non-blocking enrichment stages let pipelines degrade gracefully instead of failing entirely
