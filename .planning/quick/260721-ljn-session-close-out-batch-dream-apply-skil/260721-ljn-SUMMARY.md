# Quick Task 260721-ljn — Summary

**Task:** Session close-out batch (5 items) — dream-apply gate doc fix, memory-wiki brain-map refresh, dream plist Sonnet pin, changeset remainder, phase-34 branch cleanup
**Date:** 2026-07-21
**Branch:** `chore/session-close-out-260721`
**Commit (items 1+3):** `2d26ea4` — `chore(close-out): fix dream-apply gate docs + pin scheduled dream to Anthropic` (5 files, +39/−12)

## Item results

### Item 1 — dream-apply gate doc fix ✅
- `.claude/skills/dream-apply/SKILL.md`: 3 sites corrected (frontmatter description, step-6 "Mandatory gate", SCHEDULE backstop wording) — gate is the live-vault hybrid-search retrievability check (`src/dream.js` `_assertMergedEntriesRetrievable`), not `npm run eval:recall`.
- `scripts/dream.js`: 4 stale comment sites corrected (docstring ×2, runApply docstring, inline) — found by plan-checker, beyond the 2 originally reported.
- `grep eval:recall` clean in both files; README/CLAUDE/package.json/eval-recall.js untouched (correct Phase-32 harness).

### Item 3 — scheduled dream job pinned to Anthropic Sonnet ✅
- `src/pipeline-infra.js:159`: `LLM_PROVIDER=anthropic` process-scoped env override in the `useLocal` guard — scheduled runs pin to Anthropic; interactive sessions keep the machine-local `provider:local` overlay.
- `config/com.secondbrain.dream.plist`: `LLM_PROVIDER=anthropic` in EnvironmentVariables (no API key — dream.js loads repo .env).
- Installed to `~/Library/LaunchAgents/` and reloaded: `launchctl print` shows `LLM_PROVIDER => anthropic` live; state not-running (RunAtLoad false, monthly Day-1).
- New test: env override routes `createHaikuClient` past `provider:'local'` (mirrors existing anthropic-path test; env cleaned in afterEach). File suite: **82/82 passed**.

### Item 4 — changeset remainder: CORRECTED PREMISE ✅ (no-op by design)
- Plan-checker finding (blocking): the 3 unapplied ops (`dream-2026-07-21-004/-009/-015`) are **human-rejected** (`- [x] reject`), not pending. Changeset was already fully resolved: 12 applied + 3 rejected = 15/15.
- No checkbox flipped — overriding a review rejection would break the human-in-the-loop guarantee.
- `node scripts/dream.js --apply` confirmed: `{"applied": 0, "reason": "no accepted, not-yet-applied ops in the changeset"}`, exit 0, no snapshot restore. Post-state unchanged: 12 `applied::` + 3 rejects.

### Item 2 — memory-wiki brain-map refresh ✅
- First run (executor, unpinned) wedged on LM Studio: 17 min, 0 writes, ESTABLISHED socket to localhost:1234 — `wikilink-engine.js:458` `createHaikuClient().classify()` routed to local qwen via the overlay. Killed.
- Re-run with `LLM_PROVIDER=anthropic node scripts/migrate-memory-wiki.js --apply` (the pin fixing the exact failure it was built for): **entries 180 | coercion notes 0 | related coverage 178/180 (98.9%) | sidecar 180 parity OK | index drift false | 180 haiku calls (claude-haiku-4-5) | related:: backfilled on 173 entries**. Snapshot at `memory/.snapshots/wiki-20260721/`.
- An orphaned duplicate unpinned run (PID 12042, PPID 1, provenance unclear — mixed LM Studio + Voyage sockets) was killed; vault state verified intact after.

### Item 5 — phase-34 branch cleanup ✅
- `feat/phase-34-promotion-integrity` deleted (`-D`; squash-merged via PR #86, was 4195308).
- Worktree branch `worktree-fix-extraction-parse-and-timeout` untouched, as required.

## Verification gates
- Task 1 gate: jest pipeline-infra 82/82 ✅, eval:recall greps clean ✅, LLM_PROVIDER in code+plist ✅
- Task 2 gate: `VAULT_OK` — 12 applied / 3 rejected / INDEX:AUTO present / coverage 178/180 ✅
- Task 3 gate: branch gone ✅; full `npm test` + `npm run lint` — recorded in VERIFICATION.md (run post-summary)

## Deviations
- Executor subagent stalled twice mid-run (background jest/wiki jobs); orchestrator took over: ported/validated its diff (landed by executor as `2d26ea4`, byte-identical to reviewed patch), ran vault ops, gates, and this summary directly.
- Harness forced worktree isolation on the executor despite main-tree plan; executor ultimately committed on the batch branch itself. Its worktree (`agent-a4b6d69e173232f33`) removed after verification.
- Plan revised once (checker iteration 1/2): item-4 premise corrected, dream.js grep added to Task 1 gate, test target corrected to `createHaikuClient`.
