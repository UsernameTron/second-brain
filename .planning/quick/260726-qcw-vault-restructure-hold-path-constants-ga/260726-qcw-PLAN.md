# 260726-qcw — Vault Restructure: make the structure hold

**Date:** 2026-07-26
**Branch:** feat/vault-restructure-260726-qcw
**Type:** quick (inline execution — gsd-executor worktree is jest-blind in this repo, see tasks/lessons.md)
**Approved plan:** `~/.claude/plans/the-vault-at-claude-dazzling-lerdorf.md` (Phase A checkpoint approved by Pete 2026-07-26)

## Goal

The vault at `~/Claude Cowork/` had 83 loose root files, three standup homes, three archive roots, and drift folders unknown to `vault-paths.json`. Phase B: execute the approved 99-file move set, repoint every path constant in the same change-set, and add enforcement + daily visibility so the junk drawer does not refill.

Nothing is deleted. Every cleanup is a logged `mv`. Emptied folders are reported for Pete to delete himself.

## Tasks

1. **Baselines** (read-only): tree counts, canned `/recall --hybrid` output, one `content_hash::` from `memory-archive/2026-07.md`. — verify: files captured in scratchpad.
2. **Configs**: `config/vault-paths.json` right list → real folder set (add `archive`, `standups`, `projects`, `maps`; drop `RIGHT`, `memory-archive`, `memory-proposals-archive`); `config/pipeline.json` `stats.path` → `briefings/daily-stats.md`. — verify: config-validator skill clean.
3. **Archive constants (7 sites, one commit with the moves)**: `src/memory-proposals.js:28-29`, `src/promote-memories.js:21-22` (→ `archive/memory`, `archive/proposals`), `scripts/validate-archive.js:18`, `scripts/verify-baseline.js:34`, `src/wikilink-engine.js:172`, `src/classifier.js:189,235`. — verify: `isDuplicate()` still blocks a hash that now lives in `archive/memory/`.
4. **RIGHT/ residue**: `src/today-command.js:256,271,322`, `src/today/briefing-renderer.js:356`, `scripts/compounding-report.js:25`, `src/wikilink-engine.js:173`. — verify: grep clean for `RIGHT/daily`; briefing writes to `briefings/daily/`.
5. **Gateway enforcement**: `checkPath()` distinguishes vault-root file writes from unlisted-folder writes; `vaultWrite` drops a metadata-only quarantine record on PATH_BLOCKED before throwing (caller semantics unchanged). `vaultWriteAtomic` stays throw-only. — verify: new tests for both cases + quarantine record.
6. **Hygiene count**: loose root files + top-level folders on neither list, added to the daily-stats row and the yesterday summary line. — verify: unit test against a temp vault with known drift.
7. **Memory dashboard**: `memory/dashboard.md` regenerated whole on every promotion (category counts, last 10 promoted with dates, pending-proposal count, last-promotion timestamp; no content_hash noise). — verify: unit test + one live render.
8. **Vault moves**: 99 files + 1 dir, `mv -n`, one log line each → `archive/dispatch/2026-07-26-vault-restructure-log.md`.
9. **Docs**: routing rule in repo CLAUDE.md vault rules (new files → `inbox/`, standups → `standups/`, never root) + vault-root CLAUDE.md write-boundary line.
10. **Verification**: `npm test`, `npm run verify:baseline`, dedup proof, recall parity, reach export, tree proof.

## Non-goals

- No deletions (empty folders reported, not removed).
- No writes into `ABOUT ME/`, `Relationships/`, `Drafts/`. `Daily/` receives Connor's own two date-titled notes under the checkpoint approval only.
- No mass rewrite of `source-ref::` provenance in memory.md (governance owns that file).
- `eval/seed-vault` stays frozen with its old-path literals by design.
