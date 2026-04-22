---
phase: 04-daily-briefing-and-scheduling
plan: 01
subsystem: briefing
tags: [promise-allsettled, gray-matter, haiku-llm, slippage-scanner, vault-write]

requires:
  - phase: 01-vault-foundation
    provides: vault-gateway write-permission boundary, config loading
  - phase: 02-content-pipeline
    provides: briefing-helpers (getProposalsPendingCount, getDeadLetterSummary, formatBriefingSection), pipeline-infra (loadPipelineConfig, createHaikuClient)
  - phase: 03-external-integrations
    provides: connectors (calendar, gmail, github) with makeResult/makeError contract
provides:
  - runToday() orchestrator — single async function producing daily briefing
  - 6-section briefing renderer with decay-rate ordering
  - Cross-project slippage scanner reading STATE.md frontmatter
  - Frog identification via Haiku with heuristic fallback
  - Per-source health map in YAML frontmatter
  - Graceful degradation with grep-friendly error format
affects: [04-02-tests, 04-03-scheduling, future-v2-enhancements]

tech-stack:
  added: []
  patterns: [promise-allsettled-fan-out, inject-all-dependencies, no-throw-orchestrator]

key-files:
  created:
    - src/today-command.js
  modified:
    - config/pipeline.json
    - config/schema/pipeline.schema.json
    - src/pipeline-infra.js

key-decisions:
  - "All dependencies injectable via options object for full testability"
  - "Slippage scan is synchronous (fs.readdirSync) — simple, reliable, no async complexity for local filesystem"
  - "GitHub section renders repo-level activity counts rather than individual items"

patterns-established:
  - "Dependency injection: every external service (mcpClient, haikuClient, projectsDir, vaultRoot, date) injectable"
  - "No-throw contract: runToday never throws, returns error envelope on catastrophic failure"
  - "Degraded section format: emoji [SOURCE] ERROR_CODE: message — grep-friendly per D-10"

requirements-completed: [TODAY-01, TODAY-02, TODAY-03, TODAY-04, SCHED-02]

duration: 4min
completed: 2026-04-22
---

# Plan 04-01: Core /today Command Summary

**Fan-out daily briefing with 6 decay-rate sections, cross-project slippage scanner, Haiku frog identification, and per-source graceful degradation**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-22
- **Completed:** 2026-04-22
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added slippage config section to pipeline.json with JSON schema validation
- Built src/today-command.js (703 lines) — the capstone /today module
- Promise.allSettled fan-out to calendar, Gmail, GitHub connectors
- Inline slippage scanner reads STATE.md frontmatter across ~/projects/
- Frog identification via Haiku LLM with heuristic fallback
- 6-section briefing in D-03 decay-rate order with D-08 YAML frontmatter
- Graceful degradation: per-section warnings (D-10) and total-failure diagnostic checklist (D-11)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add slippage config to pipeline.json and update schema** - `7270b2c` (feat)
2. **Task 2: Build src/today-command.js — the complete /today module** - `ced670e` (feat)

## Files Created/Modified
- `src/today-command.js` - Core /today command module (703 lines)
- `config/pipeline.json` - Added slippage section
- `config/schema/pipeline.schema.json` - Added slippage schema definition
- `src/pipeline-infra.js` - Added 'slippage' to required config sections

## Decisions Made
- All dependencies injectable via options for testability (mcpClient, haikuClient, projectsDir, vaultRoot, date)
- Slippage scan uses synchronous fs for simplicity on local filesystem
- GitHub section renders activity counts per repo rather than individual commit/PR items
- Used manual date formatting instead of date-fns dependency

## Deviations from Plan
None - plan executed as specified.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- runToday() ready for contract testing (Plan 04-02)
- Module ready for RemoteTrigger scheduling (Plan 04-03)
- All connector interfaces consumed correctly

---
*Phase: 04-daily-briefing-and-scheduling*
*Completed: 2026-04-22*
