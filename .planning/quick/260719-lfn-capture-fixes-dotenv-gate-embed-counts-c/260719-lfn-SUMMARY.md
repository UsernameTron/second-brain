---
phase: quick-260719-lfn
plan: 01
subsystem: memory-pipeline
tags: [promotion, extraction, daily-sweep, reach-layer, launchd]
requires: []
provides: [dotenv-gated-embed-honesty, ingress-exclusion-gate, transcript-sweep, inbox-ingest, reach-15-targets, daily-sweep-schedule]
affects: [src/promote-memories.js, src/memory-extractor.js, scripts/daily-sweep.js]
tech-stack:
  added: []
  patterns: [entry-point-dotenv (HOOK-DOTENV-01), fail-closed content-policy gate, ledger-based sweep dedup]
key-files:
  created:
    - test/daily-sweep.test.js
  modified:
    - .claude/commands/promote-memories.md
    - .claude/hooks/memory-extraction-hook.js
    - src/promote-memories.js
    - src/memory-extractor.js
    - scripts/daily-sweep.js
    - config/vault-paths.json
    - config/reach-targets.json
    - test/promote-memories.test.js
    - test/memory-extractor.test.js
  external:
    - ~/Library/LaunchAgents/com.secondbrain.daily-sweep.plist
decisions:
  - "INDEX:AUTO regeneration slices out the previous block by marker position rather than regex-replace, so marker absence on first run falls through cleanly to append"
  - "Ingress gate reuses reach-exporter's checkContent/loadExcludedTerms import pattern exactly — same fail-closed semantics, no new abstraction"
  - "Transcript signal heuristic is a single keyword regex (decided/learned/prefer/constraint/pattern/git diff/pull request/merged) — cheap pre-filter before the real Haiku classification inside extractFromTranscript, not a second classifier"
metrics:
  duration: ~45min
  completed: 2026-07-19
---

# Quick Task 260719-lfn: Capture Pipeline Fixes Summary

Closed all nine confirmed capture-pipeline defects from `.planning/debug/memory-pipeline-audit.md`: promotion runs now surface real embed counts instead of silently discarding them, unsanctioned categories coerce to OTHER, memory.md carries a regenerating INDEX:AUTO block, the extraction ingress path is gated fail-closed against ISPN/Genesys/Asana, daily-sweep now actually sweeps transcripts and the Cowork inbox, reach expanded to 15 targets, and the launchd schedule is loaded and verified live.

## Task 1 — Promotion + extractor honesty (commit 6afed68)

- `dotenv.config()` added as the first statement in both entry points (`.claude/commands/promote-memories.md`'s `node -e` block, `.claude/hooks/memory-extraction-hook.js`) — mirrors `scripts/recall.js`'s HOOK-DOTENV-01 pattern. Library modules (`pipeline-infra.js`) untouched by design.
- `appendToMemoryFile` now captures `indexNewEntries`'s return `{embedded, failed}` instead of discarding it; `promoteMemories` threads `embedded`/`embedFailed` into its result, and the command's completion output prints them alongside `promoted`.
- Unsanctioned `candidate.category` values are coerced to `OTHER` with an inline justification appended to content, validated against `config/memory-categories.json` keys.
- New `regenerateAutoIndex()` writes a compact `<!-- INDEX:AUTO --> ... <!-- /INDEX:AUTO -->` block (total entries, per-category counts, month sections, last-promoted date, archive path) at the top of memory.md after each non-dry-run promote; tolerates marker absence on first run, replaces (not duplicates) on rerun.
- `memory-extractor.js` gates both `writeCandidate` call sites (transcript + file paths) with `checkContent(content, loadExcludedTerms())`, `decision !== 'PASS'` → skip, fail-closed — same import pattern as `reach-exporter.js`.

## Task 2 — daily-sweep transcript + inbox capture (commit 0f17f08)

- `sweepTranscripts()`: enumerates `~/.claude/projects/*/*.jsonl` with mtime < 24h (override via `TRANSCRIPTS_ROOT_OVERRIDE` for tests), skips directories whose name contains `worktrees`, stream-greps each unswept file with `readline` (never loads a whole transcript into memory) for a cheap signal heuristic, and only calls `extractFromTranscript` (its first live caller) on a hit. A ledger at `state/transcripts-swept.json` (gitignored) records `{path, mtime}` so an unchanged file is never re-swept.
- `sweepInbox()`: `"inbox"` added to `config/vault-paths.json`'s `right` array; creates `~/Claude Cowork/inbox/` + `inbox/archive/` if absent, calls `extractMemories({dir:'inbox'})`, then moves processed files into `inbox/archive/` (a subdir the non-recursive `extractFromDirectory` never re-scans).
- Both steps wired into `main()`'s results object, `--dry-run` aware, non-fatal per-step (try/catch → `{error}}`), matching the existing extraction/retry/archive step guards.
- `daily-sweep.js` gained a `require.main === module` guard + `module.exports` so it's requirable by tests without auto-running `main()`.

## Task 3 — Reach expansion + launchd scheduling (commit 8c2a21c)

- `config/reach-targets.json` targets array: 2 existing + 13 new slugs = 15 (within maxItems 50).
- `~/Library/LaunchAgents/com.secondbrain.daily-sweep.plist` written (Label `com.secondbrain.daily-sweep`, absolute `ProgramArguments`, `StartCalendarInterval {Hour:23,Minute:45}`, stdout/stderr to `~/Library/Logs/com.secondbrain.daily-sweep.log`), `plutil -lint` clean, loaded via `launchctl bootstrap gui/$(id -u)`, confirmed present in `launchctl list`. This file lives outside the repo (`~/Library/LaunchAgents/`) by design — not committed.

## Verification

- Full suite (real repo dir, not a worktree): 1301 total, 1272 passed, 29 skipped, 0 failed.
- `node src/config-validator.js`: all PASS/WARNING (WARNING only on the expected `daily-stats-frontmatter` no-backing-config case).
- Manual dotenv-gated end-to-end check: ran the real `promoteMemories({})` path with `.env` loaded against a scratch `VAULT_ROOT` (`REACH_TARGETS_OVERRIDE=""`) — result `{promoted:1, embedded:1, embedFailed:0}`, memory.md carried a fresh `INDEX:AUTO` block. No real vault data touched.

## Deviations from Plan

None — plan executed exactly as written across all 3 tasks.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/promote-memories.js (INDEX:AUTO, embed counts, category coercion)
- FOUND: src/memory-extractor.js (ingress gate)
- FOUND: scripts/daily-sweep.js (transcript + inbox sweep)
- FOUND: test/daily-sweep.test.js
- FOUND: config/reach-targets.json (15 targets)
- FOUND: config/vault-paths.json (inbox in right array)
- FOUND: ~/Library/LaunchAgents/com.secondbrain.daily-sweep.plist (plutil-valid, loaded)
- FOUND commit 6afed68 (Task 1)
- FOUND commit 0f17f08 (Task 2)
- FOUND commit 8c2a21c (Task 3)
