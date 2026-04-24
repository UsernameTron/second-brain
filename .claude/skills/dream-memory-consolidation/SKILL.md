---
name: dream-memory-consolidation
description: |
  4-phase memory consolidation modeled on Claude Code's /dream feature. Orients
  on existing memory files, gathers recent signal by grepping JSONL session
  transcripts and daily logs (never reading whole transcript files), merges
  duplicates, resolves contradictions, converts relative dates to absolute, and
  prunes the MEMORY.md index under 200 lines / 25KB. Scope routing: project
  (default), user, or both.

  REFUSES: Editing claude.md, creating new memories from scratch, reading full
  JSONL transcript files. For lighter cleanup use consolidate-memory.

  TRIGGERS: "/dream", "dream memory", "dream consolidation", "run dream",
  "dream user", "dream all", "dream pass", "deep memory cleanup",
  "memory + transcripts", "full memory consolidation"
---

# Dream Memory Consolidation

## QUICK START

1. Run `/dream` (project), `/dream user` (user-level), or `/dream all` (both)
2. Claude orients on memory, greps transcripts for signal, consolidates, prunes
3. Returns a summary of what changed

## WHEN TO USE

- Memory has accumulated over weeks/months and feels bloated or contradictory
- Claude is acting on outdated preferences you've since changed
- You want to verify stored memories match actual recent usage patterns
- You want the /dream experience whether or not Anthropic has enabled the feature flag
- You want to consolidate user-level memories (cross-project), not just project-level

## WHEN NOT TO USE

- Quick lightweight memory prune without transcript analysis → use `consolidate-memory`
- Edit claude.md directly → not a memory file, do it yourself
- Create new memories from scratch → just tell Claude Code in conversation
- Analyze session transcripts for non-memory purposes → not this skill

## PROCESS

### Step 0: Determine scope

Parse the invocation:

| Invocation | Scope | Target Directory |
|:-----------|:------|:-----------------|
| `/dream` or `/dream project` | Project | `~/.claude/projects/{project-hash}/memory/` |
| `/dream user` | User | `~/.claude/memory/` |
| `/dream all` | Both | User-level first, then project-level |

Run user-level first when scope is "all" (project memories may reference user-level patterns).

Expected output: `{scope}` — project, user, or all

### Step 1: Orient (Phase 1)

1. `ls` the memory directory to see what exists.
2. Read the `MEMORY.md` index. Note line count and entry count.
3. Skim each topic file to understand current state. Focus on spotting overlap, staleness, and drift — do NOT create new files yet.
4. If `logs/` or `sessions/` subdirectories exist (assistant-mode layout), note them for Phase 2.

Expected output: `{memory_catalog}` — map of all memory files with topics, approximate freshness

### Step 2: Gather recent signal (Phase 2)

Check signal sources in priority order:

**Priority 1 — Daily logs.** If `logs/YYYY/MM/YYYY-MM-DD.md` files exist, read recent ones. These are the richest append-only signal stream.

**Priority 2 — Drifted memories.** Look for facts in memory files that contradict what you can see in the codebase or project state right now.

**Priority 3 — Transcript grep.** JSONL transcript files can be enormous. NEVER read them whole. Grep narrowly for specific terms you already suspect matter:

```bash
grep -rn "<narrow term>" ~/.claude/projects/{hash}/ --include="*.jsonl" | tail -50
```

Examples of good grep terms:
- A framework name you suspect changed ("react", "vue", "nextjs")
- A preference keyword ("testing", "convention", "style")
- A project name that might be stale
- An error or tool name from recent work

Do NOT exhaustively search transcripts. Look only for things you already suspect matter based on Phase 1 findings.

Cross-reference gathered signals against the memory catalog. Flag:
- **Contradictions:** Memory says X, but recent signals show Y
- **Stale entries:** Memory references things absent from all recent signal
- **Gaps:** Repeated recent signals not captured in any memory file

Expected output: `{signal_report}` — list of contradictions, stale entries, and gaps with evidence

### Step 3: Consolidate (Phase 3)

For each issue found, write or update memory files. Follow the auto-memory format and type conventions from your system prompt — it's the source of truth for what to save and how to structure it.

**3a. Merge duplicates.** Combine overlapping files into one. Keep the richer content. Delete the redundant file.

**3b. Resolve contradictions.** When memory contradicts recent signal, trust the signal. Update the memory file. If ambiguous, ask the user: "Memory says {X} but recent sessions show {Y}. Which is current?"

**3c. Retire stale entries.** If a project/task hasn't appeared in any recent signal:
- Extract any lasting takeaway (e.g., "user prefers X for this type of work") into a durable memory.
- Delete the stale file.

**3d. Fix relative dates.** Convert "next Friday," "this quarter," "yesterday" to absolute dates so they remain interpretable after time passes.

**3e. Flag misplaced content.** If a memory file contains code conventions or project architecture that belongs in claude.md, tell the user. Do NOT move it — claude.md is the user's domain.

**3f. Tighten verbose files.** Preference memories: 5-15 lines. Project context: 10-25 lines. Cut filler.

Expected output: `{changes_made}` — files merged, updated, retired, and tightened

### Step 4: Prune and index (Phase 4)

Rebuild MEMORY.md under two hard constraints: **≤200 lines** AND **≤~25KB**.

1. Remove pointers to retired/deleted files.
2. Add pointers to newly created/merged files.
3. Format each entry: `- [Title](file.md) — one-line hook` (under ~150 chars per line).
4. Demote verbose entries: if any index line exceeds ~200 chars, it's carrying content that belongs in the topic file — shorten the line, move the detail.
5. Sort by durability: preferences first, active projects second, dated items last.
6. Resolve remaining contradictions: if two index entries point to conflicting files, fix the wrong one.

Expected output: `{updated_index}` — clean MEMORY.md under both caps

### Step 5: Report

Return a brief summary:

```
Dream consolidation complete ({scope} level):

Consolidated: {N} files merged into {M}
Updated: {N} files (corrected content/dates)
Pruned: {N} stale files retired
Unchanged: {N} files kept as-is
Index: {before} → {after} lines ({before_kb} → {after_kb} KB)

{Any items flagged for user action, e.g., misplaced content for claude.md}
```

If nothing changed (memories are already tight), say so.

Expected output: Summary report

## OUTPUT SPECIFICATION

- All changes in-place within `.claude/` directory structure
- No files created outside memory directories
- MEMORY.md ≤200 lines AND ≤~25KB after consolidation
- Individual memory files: 5-25 lines each
- Retired files deleted, not emptied
- Transcript files NEVER modified — read-only grep access

## ERROR HANDLING

| Condition | Action |
|:----------|:-------|
| No memory directory exists | "No auto-memory files found for this {scope}. Nothing to consolidate." Stop. |
| No JSONL transcripts found | Warn: "No transcripts available. Running without transcript cross-referencing." Skip Priority 3 in Phase 2. |
| No daily logs found | Skip Priority 1 in Phase 2. Continue with other sources. |
| MEMORY.md already under 50 lines | "Index is already lean. Checking content issues only." Focus on contradictions/staleness. |
| Contradiction is ambiguous | Ask user directly: "Memory says {X}, recent sessions show {Y}. Which is current?" |
| Scope "all" cascade risk | Run user-level first. Re-read project memory before modifying to catch cascade effects. |
| Transcript grep returns nothing | That signal source is empty — move on, don't force it. |

## DEPENDENCIES

- Claude Code auto-memory system (`.claude/` directory structure)
- `grep` access to JSONL session transcript files (read-only, never write)
- Permission to edit files in `.claude/memory/` directories
- Source prompt: https://github.com/Piebald-AI/claude-code-system-prompts/blob/main/system-prompts/agent-prompt-dream-memory-consolidation.md
- Source video: https://www.youtube.com/watch?v=E-1Lmyv6Cjo (Chase AI)

## RELATIONSHIP TO OTHER SKILLS

- **consolidate-memory:** Lighter 3-phase pass (read → merge/fix → prune). No transcript analysis, no daily log checks. Use for quick cleanups.
- **skill-forge:** To audit or customize this skill further.
