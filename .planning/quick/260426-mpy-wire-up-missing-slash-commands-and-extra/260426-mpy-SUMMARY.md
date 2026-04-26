---
quick_id: 260426-mpy
title: Wire up missing slash commands and extract GSD knowledge into memory proposals
status: complete
tasks_completed: 2
tasks_total: 2
---

# Quick Task 260426-mpy — Summary

## Task 1: Wire up missing slash commands

Created 5 `.claude/commands/*.md` files using `recall.md` as the template pattern:

| Command | Source Module | Entry Function |
|---------|-------------|----------------|
| `/today` | `src/today-command.js` | `runToday()` |
| `/new` | `src/classifier.js` | `classifyInput(content)` |
| `/wrap` | `src/memory-extractor.js` | `extractMemories(opts)` |
| `/promote-memories` | `src/promote-memories.js` | `promoteMemories(opts)` |
| `/promote-unrouted` | `src/promote-unrouted.js` | `promoteUnrouted(filename, opts)` |

Each file includes:
- YAML frontmatter with usage description
- Markdown body explaining command behavior
- Reference implementation as `node -e` one-liner with `$ARGUMENTS` passthrough
- Flag/argument documentation

All 6 command files verified present (5 new + 1 existing `recall.md`).

## Task 2: Extract GSD knowledge into memory-proposals.md

Extracted 18 memory proposals from 5 GSD source files into `~/Claude Cowork/proposals/memory-proposals.md`.

**Sources read:**
- `tasks/lessons.md` (28 active rules)
- `.planning/PROJECT.md` (architecture, decisions, constraints)
- `.planning/MILESTONES.md` (6 milestone summaries with locked decisions)
- `.planning/RETROSPECTIVE.md` (what-worked/inefficient/lessons across 4 milestones)
- `.planning/milestones/v1.4-MILESTONE-AUDIT.md` (audit findings, process gaps)

**Proposals by category:**
- DECISION (4): left/right write boundary, zero-trust permissions, Voyage threshold calibration, embed-on-promotion sidecar
- LEARNING (14): classifier architecture, allSettled pattern, uniform result shapes, squash-merge debugging, branch protection gotcha, manifest-first protocol, CI=true signal, Pattern 7 degradation, Path B for deferred work, lock fence verification, config overlay, CI ratchet, god module decomposition, cross-AI audit

**Coverage:**
- Architectural decisions and WHY: 6 proposals
- Debugging patterns: 3 proposals (git, branch protection, CI environment)
- Framework/process patterns: 5 proposals (manifest-first, ratchet, Path B, lock fence, decomposition)
- Integration gotchas: 4 proposals (Voyage calibration, degradation, config overlay, embed sidecar)

All proposals staged as `status:: pending` for human review via `/promote-memories`.
