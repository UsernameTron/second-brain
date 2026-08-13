# START HERE — next session pickup
_Vault/memory-pipeline sections written 2026-07-31. Agent Canvas section added 2026-08-13._

> ## Two workstreams live in this repo — pick the right one
>
> **1. Agent Canvas (ACTIVE as of 2026-08-13)** — `agent-canvas/`, a deployed
> Cloud Run product for cloudtechgurus.com, independent of the vault and the
> memory pipeline. **Its handoff is the authority:
> [agent-canvas/docs/HANDOFF.md](agent-canvas/docs/HANDOFF.md) — start there,
> not here.** One-line state: the Agent Roster is live on revision
> `00023-xhf`; branch `claude/agent-canvas-roster-heal` is pushed and green
> but its PR still needs opening (this environment's proxy blocks GitHub API
> writes), then a redeploy to heal pre-roster content in the live database.
>
> **2. Second Brain vault + memory pipeline** — everything below this block.
> Last touched 2026-07-31; the P1-P8 task list is still accurate and still
> unstarted. Nothing in the Agent Canvas work touched `src/`, `memory.md`,
> the vault, or the eval harness, so these two do not interact.


## Vault / memory pipeline — what the 2026-07-31 session accomplished
- Merged PR #96 — the audit & improvement pass: 13 reliability fixes (7 from the 2026-07-30 audit, 6 from Codex review). Post-merge CI and CodeQL both green; master is at 161e9f0.
- Killed the silent-loss bug in the memory pipeline: `acquireLock` (src/memory-proposals.js) now probes the recorded pid with `process.kill(pid,0)` before reclaiming a stale-by-age lock, so live/EPERM holders are never reclaimed and a SIGKILLed holder no longer leaves `proposals.lock` forever while every later candidate is buffered but reported as staged. That fix released the buffered backlog (reported as 483 candidates by the run that drained it; no pending-buffer artifact survives to re-verify that figure).
- Timeout plumbing is real end to end: `callOptions.timeoutMs` now caps the local model (`Math.min` against `localTimeoutMs`, so the Stop hook passes 50000ms instead of inheriting the 900s config), sets the Anthropic SDK per-request `{ timeout }`, and acts as a single extraction-WIDE deadline in the extractor. `oversizeThresholdBytes` (5 MiB) is enforced instead of being dead config.
- Three more no-silent-failure fixes: `scripts/today-scheduled.js` exits 1 on an error envelope (launchd no longer records success on briefing-less mornings); `extractFromFile` records candidate-loop throws via `recordFailure` instead of aborting a whole directory sweep; `loadExcludedTerms` logs a `LOAD_ERROR` decision instead of silently returning `[]` and disabling the exclusion gate.
- Drained the proposals gate: the buffered backlog reviewed against fixed criteria — 98 promoted through /promote-memories in 10 batches (the batch cap is 10), 405 rejected and archived (never deleted), 2 synthetic dedup-test fixtures deliberately left unresolved, 0 ISPN/Genesys/Asana exclusion violations. memory.md is now 285 entries (was 183, per the pre-promotion snapshot in `memory/.snapshots/dream-20260731/`: 183 + 98 promotions + 4 applied merges = 285), and the embeddings sidecar holds 285 vectors — full coverage, verified.
- Ran the monthly dream cycle: `dream:propose` staged 15 MERGE ops + 5 missed-pattern ADDs; 4 merges accepted after per-op review and applied by `dream:apply` with the live retrievability gate PASSING (no snapshot restore); 11 rejected with written reasons in `proposals/dream-changeset-2026-07.md`.
- Retrieval eval run before and after the code changes, unchanged against `eval/baseline-2026-07-19.json` — keyword recall@5 0.900 / MRR 0.900, semantic 0.800 / 0.800, hybrid 0.900 / 0.900. It scores the FROZEN seed vault (`eval/seed-vault/`), so it gates retrieval CODE, not live memory.md edits.
- Raised the local-model ceiling on this MacBook Pro (M4 Pro, 48 GB): qwen/qwen3.6-27b loaded context 32768 → 65536 with flash attention and q8_0 K/V cache quantization, persisted in the LM Studio per-model config so every future load (including the server's JIT loads) inherits it; `config/pipeline.local.json` localTimeoutMs 60000 → 900000. Two real extractions completed at ~49k prompt tokens. Prefill ~86 tok/s cold (~9.5 min for a 49k request, ~26 s warm on a prompt-cache hit), generation ~6-7 tok/s. Root cause it fixed: server logs showed real 33,315- and 62,968-token extraction requests rejected against the old 32,768 context.
- Restructured the vault graph: new `maps/` MOC layer (8 notes: `home.md` as the single entry point, 6 MOCs, and `how-to-read-the-brain-map.md` — the graph legend), 16 files triaged into `archive/` (moves only, nothing deleted), 8 empty dirs removed, quarantine manifest added for `archive/unrouted-quarantine-20260720/` (4,560 quarantined files, 4,561 including that manifest; ~18 MB). LEFT-side `aliases:` added to three `ABOUT ME/` notes under explicit operator authorization — that closes audit P2 and lets 61 title-form links in memory.md resolve (35 + 17 + 9 across the three aliased targets).

## Where to go (project directory)
- Primary work:  ~/projects/second-brain
- Vault:         ~/Claude Cowork  (a separate agent owns vault-side changes)
- Audit report:  ~/Claude Cowork/inbox/archive/second-brain-audit-2026-07-30.md — the ranked P1-P8 roadmap the task list below draws from

## Your tasks, in order (the audit findings still unfixed, ranked by impact)
1. **P1 — memory provenance gap.** Verified 2026-07-31: all 16 `merged-from::` entries in memory.md lack both `source-ref::` and `added::`. The MERGE writer in `src/dream.js` (~L482-487) emits only `category`/`merged-from`/`tags`/`content_hash`, so today's 4 applied merges added 4 more to the original 12 from 2026-07-21. Patch the writer first so it can't happen again, then backfill the 16 through the proposal gate. Note the framing correction: only 4 of the 16 come from today's cycle — the other 12 date 2026-07-21, so they are older than all 98 entries promoted today. Prioritize this for the writer bug, not for the entries' recency.
2. **P3 remainder — same-session cross-category duplication.** Today's dream pass handled the live duplicate pairs; the systemic cause is untouched. The extractor still promotes one fact as both LEARNING and PATTERN in a single session. Add a same-session cross-category dedup check.
3. **P4 — OTHER-category justification is unenforced.** memory.md now holds 8 OTHER entries (the audit found 5), and there is no promotion-time justification gate in `src/promote-memories.js` — the extractor prompt asks for a justification, nothing rejects a candidate without one.
4. **P5 — silent degradation in /today.** No `degradedSections` marker exists anywhere in `src/`. Ten bare catch blocks across two groups still swallow errors — the briefing sections at `src/today-command.js` 288/299/314/332/338 and the daily-stats group at 461/470/476/482/496, so a broken memory-health module produces normal-looking briefings forever. Also: non-atomic health-file increments in `src/utils/classifier-health.js`, and fallback-to-Haiku is invisible in instrumentation.
5. **P6 — daily-sweep has no overall deadline.** Higher stakes than when the audit was written: with localTimeoutMs now 900000, N chunks × 900s can run the 23:45 sweep into the 06:45 /today job. `scripts/daily-sweep.js` tracks `startedAt` for duration reporting only — one elapsed-time check in the chunk loop closes it.
6. **P7 — dead path references in memory.md.** The INDEX archive path is now correct (`/Users/cpconnor/Claude Cowork/archive/memory`, which exists), but 19 entries still cite an `_audit/2026-07-18` path that does not. Fix via the proposal gate.
7. **P8 — vault hygiene follow-ups.** Standardize the three standup filename conventions before the MOC links calcify; decide the fate of the 4,560-file quarantine (delete after review, or keep it excluded from graph and search); exclude `memory/.snapshots/` from graph analytics via Obsidian settings rather than deleting — they are dream:apply safety snapshots; archive the two empty briefing dry-run eras.

## Open loops / blockers
- **Two items need Pete — see [.planning/todos.md](.planning/todos.md) (5 open).** (1) `config/schema/pipeline.schema.json:297` still defaults `daily-stats` to the retired `RIGHT/` path, which yields `PATH_BLOCKED`; `config/schema/` is protected-file-guarded so it needs a manual edit, and the exact diff is in the todo. (2) Three classifier destinations — `job-hunt`, `interview-prep`, `ideas` — are still allowlisted and advertised, but the restructure removed their vault directories; keep them live (they silently reappear on first use) or retire them properly, which needs a UAT corpus revalidation.
- **Voyage AI is funded and working.** The operator installed a new key with billing, and the health tracker reports 0 consecutive failures. Note the tracker still records a same-day 429 (`last_failure_code: "429"`, 14:53Z) — the counter resets on any success, so treat "0 consecutive" as "working now", not as proof the rate-limit class is gone.
- **The local model is degraded and it is structural, not a blip.** `~/.cache/second-brain/classifier-health.json` shows 6 consecutive `timeout` failures and `haiku_calls: 50` — the entire `haikuNightlyCap` of 50 spent in one day. Cause: the Stop hook passes a 50 s budget (`.claude/hooks/memory-extraction-hook.js:50`), and at the model's measured ~86 tok/s cold prefill that covers only ~4,300 prompt tokens, while a real session transcript is orders of magnitude larger. So hook-driven local extraction times out by arithmetic every time and falls back to Haiku. LM Studio itself is healthy (serving at 65,536 context). See the ROADMAP candidate — the likely fix is to stop attempting local extraction from the hook and reserve the local provider for terminal `/wrap`, where the full 900 s applies.
- The proposals gate is drained. 2 candidates remain pending and both are test fixtures (`session:abc12345`, IDs dated 20260422) — nothing real is waiting for review.
- v1.8 Phase 36 (Ingest Breadth) is still decision-gated and unscheduled. The gate is a real L10 RAG Phase 3 timeline. Pete's call.
- v1.7 VERDICT-01 is calendar-gated: due ~2026-08-06, needs ≥14 weekday daily-stats rows.
- Carried forward from the 2026-07-14 session and NOT re-verified since — these live in ~/projects/CTG-Workspace-Build/projects/ctg-l10-eos, not this repo. Confirm against that repo before acting on any of them: the AUTHORITY map + NEVER_LIST in ratifyDecision.ts are unratified pending Fred; proposeDecision is armed against production but headless until DecisionsView ships; ctg-ops-prod billing is off while ctg-ops-automation (PRM ops) lives there.
- Also carried forward, unverified: session-harvest.zip was built on 2026-07-14 and still needs uploading. `/wrap` covers session capture today, so check whether this is still wanted before spending time on it.

## To capture THIS work next time
Run `/wrap` at session end — it stages extracted candidates to `proposals/memory-proposals.md`, exits non-zero when extraction hard-fails (so a failed extraction is distinguishable from an empty one), and now prints "N staged, M buffered — run /wrap again to drain" so a buffered backlog is visible instead of silent. Then `/promote-memories` for the human gate, and confirm the sidecar vector count matches the entry count.
