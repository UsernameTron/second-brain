---
name: dream-propose
description: |
  Monthly, human-invocable propose pass over the vault's compounding memory
  store at memory/memory.md (NOT Claude Code's own MEMORY.md auto-memory
  files — see the separate dream-memory-consolidation skill for that store).
  Re-reads recent session-log/decisions signal and the memory.md embeddings
  sidecar to detect three op types, all proposals, nothing ever applied:
  MERGE (near-duplicate entries, cosine >= mergeCosineMin, Sonnet-authored
  with a mechanical anti-hallucination quote guard), STALE (contradicted /
  dead-reference / over-age flags), and MISSED PATTERNS (cross-session
  patterns the extractor missed, staged as plain ADDs into the existing
  proposals/memory-proposals.md gate). MERGE/STALE land in a reviewable
  proposals/dream-changeset-YYYY-MM.md; propose refuses to run while an
  unresolved changeset already exists. Applies NOTHING to memory.md.

  TRIGGERS: "/dream-propose", "dream propose", "run dream propose",
  "monthly memory consolidation", "propose memory merges"
---

# /dream-propose

## QUICK START

Run `node scripts/dream.js --propose` (or `npm run dream:propose`) from the
repo root. It:

1. Refuses immediately if an unresolved `proposals/dream-changeset-*.md`
   already exists — resolve it via human review first (no pile-up).
2. Detects MERGE pairs (embeddings cosine, zero tokens) and authors each via
   Sonnet with a mechanical quote-verification guard — a fabricated merge
   is dropped, never proposed.
3. Detects STALE flags: dead file/config references (zero tokens), age in
   ephemeral categories only (never CONSTRAINT/PREFERENCE), and
   contradictions via the shared `checkContradiction` helper — bounded by
   `maxStaleFlags` and the shared `maxLLMCalls` budget.
4. Extracts MISSED PATTERNS from `state/session-log.md` + `state/decisions.md`
   (windowed by `sessionLogWindow` days), deduped by content_hash AND
   embedding cosine vs live entries, and stages survivors as plain ADDs into
   `proposals/memory-proposals.md` for the existing `/promote-memories`
   human review gate.
5. Writes `proposals/dream-changeset-YYYY-MM.md` for the MERGE/STALE ops
   (accept/reject/defer checkboxes, same mechanics as the promotion gate)
   and updates `state/dream-ledger.json`.

`node scripts/dream.js --dry-run` runs the same detection but writes
nothing (no changeset, no ledger update, no proposal ADDs) — safe to run
any time to preview.

## WHEN TO USE

- Monthly review of the vault memory store for duplicate/stale entries and
  missed cross-session patterns
- Manually, before/instead of waiting for the scheduled monthly launchd run

## SCHEDULE

Monthly, day 1, 07:15 local — `~/Library/LaunchAgents/com.secondbrain.dream.plist`
(source committed at `config/com.secondbrain.dream.plist`), running
`--propose` ONLY. `/dream-apply` (the human-invoked apply step, Plan 34-07)
is never scheduled.

## REFUSES

Editing `memory/memory.md` directly, applying any op automatically,
deleting memory entries, running while an unresolved changeset exists.
