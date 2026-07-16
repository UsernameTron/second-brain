---
phase: 02-content-pipeline
plan: 02
subsystem: pipeline
tags: [classifier, haiku, sonnet, note-formatter, new-command, routing]

requires:
  - phase: 02-content-pipeline/01
    provides: pipeline-infra.js (Haiku/Sonnet clients, correlation IDs, dead-letter writer)
provides:
  - Two-stage classifier: voice gate (LEFT/RIGHT) → subdirectory picker
  - Note formatter with domain-aware frontmatter and template overlays
  - /new command orchestrating 6-stage pipeline from raw input to written note
affects: [02-05, 02-06]

tech-stack:
  added: []
  patterns: [two-stage classification with Sonnet escalation, structured event logging, pipeline correlation]

key-files:
  created:
    - src/classifier.js
    - src/note-formatter.js
    - src/new-command.js
    - test/classifier.test.js
    - test/note-formatter.test.js
    - test/new-command.test.js

key-decisions:
  - "Two-stage classifier: Stage 1 voice gate (LEFT/RIGHT), Stage 2 subdirectory pick"
  - "Sonnet escalation when Haiku confidence below threshold per D-04"
  - "Non-interactive input routes to dead-letter if ambiguous (no human to ask)"

patterns-established:
  - "Classifier returns structured decision with confidence, correlation ID, and audit event"
  - "Note formatter applies domain-specific frontmatter from templates.json"

requirements-completed: [INPUT-01, INPUT-02, INPUT-04]

duration: 15min
completed: 2026-04-22
---

# Plan 02-02: Two-Stage Classifier + /new Command Summary

**Two-stage LLM classifier (voice gate + subdir picker) with note formatter and /new pipeline orchestrator**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-04-22
- **Tasks:** 2
- **Files created:** 6

## Accomplishments
- Two-stage classifier: Stage 1 voice gate separates LEFT/RIGHT with configurable confidence thresholds, Stage 2 picks subdirectory with Sonnet escalation
- Note formatter with domain-aware frontmatter from templates.json overlays
- /new command orchestrating full 6-stage pipeline: input → classify → format → write → (wikilinks placeholder) → log
- Structured event logging with correlation IDs throughout

## Task Commits

1. **Task 1: Two-stage classifier** - `1485af0`
2. **Task 2: Note formatter and /new command** - `c2fec5a`

## Decisions Made
- Non-interactive ambiguous input routes to dead-letter (no human to disambiguate)
- LEFT-classified input writes to proposals/left-proposals/ (human review required)

## Deviations from Plan
None - plan executed as written.

## Issues Encountered
None.

## Next Phase Readiness
- /new command ready for wikilink integration from Plan 02-03
- Classifier available for memory extraction pipeline (Plan 02-04)

---
*Phase: 02-content-pipeline*
*Completed: 2026-04-22*
