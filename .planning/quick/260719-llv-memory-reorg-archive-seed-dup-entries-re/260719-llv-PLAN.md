---
phase: quick-260719-llv
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - "~/Claude Cowork/memory/memory.md"
  - "~/Claude Cowork/memory-archive/YYYY-MM.md"
  - "~/.cache/second-brain/embeddings.jsonl"
autonomous: true
requirements: [MEMREORG-01]
must_haves:
  truths:
    - "memory.md holds ~134 entries; the 9 seed/test and 13 duplicate-loser entries are gone from it and present verbatim in memory-archive/ with archived:: + superseded_by:: fields"
    - "Zero INSIGHT and zero PRINCIPLE categories remain in memory.md; every OTHER entry carries a one-sentence justification"
    - "A ≤15-line auto-index sits between <!-- INDEX:AUTO --> markers at the top of memory.md"
    - "Every memory.md content_hash has exactly one embeddings.jsonl vector row; orphan rows are pruned"
    - "Keyword recall still returns a known surviving entry; archived hashes still block re-promotion via the memory-archive dedup scan"
  artifacts:
    - path: "~/Claude Cowork/memory-archive/YYYY-MM.md"
      provides: "Archived seed + duplicate-loser entries by original month, with archived::/superseded_by:: fields"
      contains: "archived::"
    - path: "~/Claude Cowork/memory/memory.md"
      provides: "Reorganized memory with clean categories + auto-index"
      contains: "INDEX:AUTO"
  key_links:
    - from: "src/promote-memories.js"
      to: "~/Claude Cowork/memory-archive/"
      via: "ARCHIVE_DIR dedup scan blocks re-promotion of archived hashes"
      pattern: "ARCHIVE_DIR"
---

<objective>
Operator-approved reorganization of the RIGHT-side vault memory (`~/Claude Cowork/memory/memory.md`, 156 entries): archive seed/test + duplicate-loser entries, recategorize 25 miscategorized entries in place, generate the top-of-file auto-index, and reconcile the embeddings sidecar. Archive-not-delete throughout.
Purpose: memory.md carries seed fixtures, duplicates, and category drift that pollute recall and compounding metrics. This is a one-time data cleanup — no repo code changes (parallel task 260719-lfn owns those).
Output: reorganized memory.md (~134 entries), new memory-archive/YYYY-MM.md files, pruned+healed embeddings.jsonl, timestamped pre-mutation snapshots.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@.claude/skills/dream-memory-consolidation/SKILL.md
@decisions/ADR-020-authority-hierarchy.md
@config/memory-categories.json

<interfaces>
Confirmed at plan time (src/promote-memories.js):
- VAULT_ROOT = process.env.VAULT_ROOT || ~/Claude Cowork
- MEMORY_FILE = VAULT_ROOT/memory/memory.md
- ARCHIVE_DIR = VAULT_ROOT/memory-archive   <- dedup scan reads here; putting losers here blocks re-promotion
- PROPOSALS_FILE = VAULT_ROOT/proposals/memory-proposals.md  <- NEVER touch (40 human-gated candidates)
- computeHash, sourceRefShort from src/utils/memory-utils
- Sidecar: ~/.cache/second-brain/embeddings.jsonl (regenerable), index-metadata.json
- Heal path: `node scripts/recall.js --semantic "<query>"` loads dotenv and runs selfHealIfNeeded (embeds gaps)
</interfaces>

HARD RULES (fail-closed):
- Never delete memory content — archive by moving verbatim. Only sidecar row pruning removes data, and only orphan rows.
- Never write the LEFT vault side. Never touch proposals/memory-proposals.md.
- ISPN / Genesys / Asana exclusions stay excluded.
- Snapshots BEFORE any mutation. Every count claim must be backed by command output.
- Line numbers in this plan are from the 2026-07-19 audit and shift as entries move — locate each entry by content_hash / header text, NOT live line number.
- Another executor (260719-lfn) is committing src/ code concurrently — this plan touches ONLY vault data, the sidecar, and its own .planning artifacts.
</context>

<tasks>

<task type="auto">
  <name>Task A: Snapshot + archive seed and duplicate entries</name>
  <files>
    ~/Claude Cowork/memory/memory.md (remove archived entries)
    ~/Claude Cowork/memory-archive/YYYY-MM.md (create per original entry month)
    ~/.cache/second-brain/embeddings.jsonl (snapshot only, no edit here)
    ~/.cache/second-brain/index-metadata.json (snapshot only)
  </files>
  <action>
  1. Snapshot FIRST (rollback basis — memory.md is NOT git-tracked). Copy with suffix `.pre-reorg.<ISO-ts>`:
     memory.md, embeddings.jsonl, index-metadata.json. Verify all three copies exist before mutating anything.
  2. Create `~/Claude Cowork/memory-archive/` (matches src/promote-memories.js ARCHIVE_DIR exactly — this is what the dedup scan reads).
  3. Move these entries VERBATIM out of memory.md into `memory-archive/YYYY-MM.md` bucketed by each entry's ORIGINAL entry date. On each moved entry append two fields:
     `archived:: <ISO date> · <reason>` and `superseded_by:: <content_hash of survivor | none>`.
     - seed/test (reason `seed-data`, 9 entries, superseded_by:: none): the L1622 "Test decision content." fixture, plus the eight 2026-04-24 synthetic block entries at L1634, L1645, L1656, L1667, L1678, L1689, L1700, L1711.
     - duplicates (reason `duplicate`, 13 entries — archive the LOSER, survivor stays in memory.md; superseded_by:: = survivor's content_hash):
       archive L630 (keep L3), L619 (keep L25), L641 (keep L14), L69 (keep L597), L80 (keep L47),
       L91 (keep L278), L531 (keep L179), L289 (keep L223), L421 (keep L256), L58 (keep L267+L157),
       L311 (keep L905), L322 (keep L1026).
  Locate every entry by content_hash / header text — not by the (now-shifting) line number. Do NOT edit the sidecar in this task.
  </action>
  <verify>
  Snapshots: `ls ~/.cache/second-brain/*.pre-reorg.* ~/Claude\ Cowork/memory/*.pre-reorg.*` shows 3 files.
  Archive: `grep -c '^archived::' ~/Claude\ Cowork/memory-archive/*.md` totals 22 (9 seed + 13 dup).
  Removed count: entry-header count in memory.md dropped by exactly 22 vs the snapshot (grep the entry-header pattern in both, diff the counts).
  </verify>
  <done>memory.md has 22 fewer entries (156→134); all 22 live verbatim in memory-archive/ with archived::/superseded_by:: fields; three .pre-reorg snapshots exist; no survivor entry was moved.</done>
</task>

<task type="auto">
  <name>Task B: Recategorize 25 entries in place + generate auto-index</name>
  <files>~/Claude Cowork/memory/memory.md</files>
  <action>
  Edit BOTH the header `· CATEGORY ·` token AND the `category::` field line for each entry (locate by content_hash/header text). All targets must map to a sanctioned category in config/memory-categories.json (no INSIGHT/PRINCIPLE — those are unsanctioned and must be zeroed):
    - INSIGHT→RELATIONSHIP: L707, L795
    - INSIGHT→PREFERENCE: L663
    - INSIGHT→LEARNING: L817, L971, L1246
    - INSIGHT→CONSTRAINT: L949
    - INSIGHT→OTHER: L828, L982  (ADD the mandatory one-sentence justification per memory-categories.json OTHER rule)
    - PRINCIPLE→PREFERENCE: L762, L839, L960
    - PRINCIPLE→PATTERN: L850, L861, L894, L938, L993, L1004, L1114, L1125
    - PRINCIPLE→CONSTRAINT: L773
    - LEARNING→RELATIONSHIP: L696
    - OTHER→LEARNING: L190
    - CONSTRAINT→LEARNING: L3
  Then add missing one-sentence justifications to the remaining OTHER entries L102 and L201.
  Then generate the initial ≤15-line index between `<!-- INDEX:AUTO -->` markers at the top of memory.md: total entries, per-category counts, month sections, last-promoted date, archive pointer. Match the format the new promote-memories.js index code writes — read that code first IF task 260719-lfn's index commit has landed (grep src/promote-memories.js for INDEX:AUTO); if it has NOT landed, match the 2026-07-19 audit-spec format and note in the SUMMARY that it needs a format re-check once lfn lands.
  </action>
  <verify>
  `grep -Ec 'INSIGHT|PRINCIPLE' ~/Claude\ Cowork/memory/memory.md` returns 0.
  Every OTHER entry has a justification: for each `category:: OTHER` block, confirm a justification sentence is present (spot-grep + manual scan of the OTHER blocks; count of OTHER blocks == count with justification).
  Index present: `grep -c 'INDEX:AUTO' memory.md` == 2 and the block between markers is ≤15 lines.
  </verify>
  <done>Zero INSIGHT/PRINCIPLE tokens remain; all 25 targets recategorized in both header and category:: line; every OTHER entry justified (incl. L102, L201); ≤15-line auto-index present between markers.</done>
</task>

<task type="auto">
  <name>Task C: Sidecar prune + heal + full verification</name>
  <files>~/.cache/second-brain/embeddings.jsonl</files>
  <action>
  Follow the dream-memory-consolidation SKILL procedure where it applies; if it conflicts with anything here, the skill's SAFETY rules win and this scope list wins on scope.
  1. PRUNE embeddings.jsonl: remove rows whose content_hash no longer appears in memory.md — the ~28 pre-existing orphans plus the 22 newly archived hashes. Regenerable cache, prune is safe. Compute the memory.md hash set, drop non-member rows, report rows-before / rows-after / rows-removed.
  2. HEAL missing vectors: run `node scripts/recall.js --semantic "memory reorganization"` from the repo root (loads dotenv; selfHealIfNeeded embeds gaps). Then verify EVERY memory.md content_hash has a vector row — report `N entries / N vectors` and confirm equality.
  3. VERIFY the whole reorg:
     - memory.md ≈134 entries (count entry headers).
     - Zero INSIGHT/PRINCIPLE categories (grep == 0).
     - All OTHER entries justified.
     - Keyword recall still returns a known surviving entry: `node scripts/recall.js "<term from a survivor>"` returns it.
     - Archived hashes still block re-promotion: confirm src/promote-memories.js ARCHIVE_DIR dedup scans memory-archive/ (grep code) and that an archived hash is present in memory-archive/.
  </action>
  <verify>
  `wc -l ~/.cache/second-brain/embeddings.jsonl` before/after shows the drop; every memory.md hash has a vector (report N/N equal).
  `node scripts/recall.js "<survivor term>"` returns the expected surviving entry.
  `grep -Ec 'INSIGHT|PRINCIPLE' memory.md` == 0.
  </verify>
  <done>embeddings.jsonl has exactly one vector per current memory.md entry (N entries == N vectors), orphans pruned; recall returns a survivor; archived hashes remain in memory-archive/ where the dedup scan blocks re-promotion; all reorg counts verified by command output.</done>
</task>

</tasks>

<verification>
- memory.md: 156 → ~134 entries; 22 entries archived verbatim with archived::/superseded_by::.
- Zero INSIGHT/PRINCIPLE; all OTHER entries justified; ≤15-line auto-index between INDEX:AUTO markers.
- embeddings.jsonl: N vectors == N memory.md entries; orphans pruned.
- Keyword recall returns a known survivor; archived hashes block re-promotion.
- Pre-mutation snapshots (.pre-reorg.<ts>) exist for memory.md, embeddings.jsonl, index-metadata.json.
- LEFT vault untouched; proposals/memory-proposals.md untouched; no src/ edits.
</verification>

<success_criteria>
Every count claim (134 entries, 22 archived, 0 INSIGHT/PRINCIPLE, N==N vectors) is backed by command output captured in the SUMMARY. Rollback is possible from the three snapshots. No content deleted except orphan sidecar rows.
</success_criteria>

<output>
After completion, create `.planning/quick/260719-llv-memory-reorg-archive-seed-dup-entries-re/260719-llv-SUMMARY.md` recording: snapshot paths, before/after entry counts (command output), archive file paths + entry counts, recategorization confirmation (grep == 0), sidecar rows-before/after/removed + N==N vector parity, and whether the index format was matched to landed lfn code or to the audit spec (flag if the latter).
</output>
