---
quick_id: 260426-mpy
title: Wire up missing slash commands and extract GSD knowledge into memory proposals
task_count: 2
---

# Quick Plan: 260426-mpy

## Task 1: Create .claude/commands/ files for 5 missing slash commands

**Files:** `.claude/commands/today.md`, `.claude/commands/new.md`, `.claude/commands/wrap.md`, `.claude/commands/promote-memories.md`, `.claude/commands/promote-unrouted.md`
**Template:** `.claude/commands/recall.md`
**Action:** Create command files matching recall.md pattern (YAML frontmatter with description, markdown body with invocation, reference implementation as node one-liner). Each wires to the correct src/ module and exported function:
- `/today` → `src/today-command.js` → `runToday()`
- `/new` → `src/classifier.js` → `classifyInput(content)` — takes $ARGUMENTS as content
- `/wrap` → `src/memory-extractor.js` → `extractFromTranscript()` — session extraction entry
- `/promote-memories` → `src/promote-memories.js` → `promoteMemories()`
- `/promote-unrouted` → `src/promote-unrouted.js` → `promoteUnrouted(filename, options)` — takes filename + --target flag
**Verify:** Each file exists with valid YAML frontmatter and node invocation block.

## Task 2: Extract GSD knowledge into memory-proposals.md

**Sources:** `tasks/lessons.md`, `.planning/PROJECT.md`, `.planning/MILESTONES.md`, `.planning/milestones/v1.4-MILESTONE-AUDIT.md`
**Target:** `~/Claude Cowork/proposals/memory-proposals.md` (append)
**Format:** memory-proposals.md schema — `### mem-YYYYMMDD-NNN · CATEGORY · source` blocks with checkboxes, content, tags, metadata fields
**Action:** Extract reusable architectural/debugging/framework/integration knowledge. Focus on WHY decisions were made, not timeline. Write as pending proposals for human review.
**Verify:** Proposals file updated with new entries, frontmatter total_pending incremented.
