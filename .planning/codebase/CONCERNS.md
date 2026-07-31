# Codebase Concerns

**Analysis Date:** 2026-07-31

## Tech Debt

**Five briefing-section catches in `src/today-command.js` degrade silently — OPEN, found 2026-07-31, not fixed**
- Each of the five `/today` composition sections swallows its error with no log line: Memory Echo (`:288`, sets a `{skipped:true}` sentinel), the echo-shown stats record (`:299`), Memory Health (`:314`), compounding trend (`:332`), sweep status (`:338`). All five carry a `/* non-fatal — briefing-is-the-product */`-style comment and nothing else.
- The rationale is sound — the briefing ships even if a sub-fetch fails — but nothing records *that* it failed, so a permanently-broken `readDailyStats` renders as a permanently-missing section with no signal anywhere. The same shape repeats in the stats-recording aggregate at `:459-496`, where `:498` states the reason outright: `// Per CLAUDE.md ESLint config: no console.* in production. Silent catch.` That reads the convention too narrowly — `logDecision()` and `process.stderr.write` are the sanctioned channels and are already used elsewhere in this same file.
- Impact: observability, not correctness. A degraded `/today` is indistinguishable from a `/today` with genuinely nothing to report.
- Fix approach: replace each bare catch with a one-line `logDecision('TODAY', '<section>', 'DEGRADED', err.message)`. Same fail-open behavior, plus a stderr breadcrumb. This is exactly the pattern PR #96 applied to `loadExcludedTerms()`.

**`src/utils/classifier-health.js` increments are read-modify-write, not atomic — OPEN, found 2026-07-31, not fixed**
- `recordFailure()` (`:98-105`) and `recordHaikuCall()` (`:146-152`) both do `readHealth()` → mutate → `_writeHealth(state)`. Two concurrent invocations interleaving between the read and the write lose one increment.
- The state is explicitly cross-invocation by design (interactive session, 23:45 sweep, monthly dream all share `~/.cache/second-brain/classifier-health.json`), so concurrency is the expected case, not the exotic one.
- Impact: bounded but real — an undercounted `haiku_calls` lets the nightly Haiku cap (`haikuNightlyCap: 50`) be exceeded, and an undercounted `consecutive_failures` delays the degraded-mode window that exists to stop burning timeouts on a wedged local model.
- Fix approach: the same lease-lock pattern `memory-proposals.js` already uses, or a compare-and-swap on the file's mtime. Not worth a new dependency.

**Haiku fallback is invisible in `classifier:decision` instrumentation — OPEN, found 2026-07-31, not fixed**
- The instrumentation payload built at `src/classifier.js:365-373` carries `correlationId`, `inputLength`, `interactive`, `stage1`, `stage2`, `sonnetEscalated`, `destination` — and no field naming which provider actually served the call.
- `classifyLocalWithHealth()` (`src/pipeline-infra.js:356-382`) falls back from LM Studio to Anthropic Haiku on any local failure and emits a `logDecision` line only on the *cap-reached* path; a normal fallback records the failure in the health tracker and returns silently.
- Impact: cost and diagnosis. Reading `classifier:decision` logs, a run that quietly paid for 50 Haiku calls looks identical to one served entirely by the local model.
- Fix approach: add `provider` (and `fallback: true|false`) to the instrumentation payload, sourced from the client result. One field, no behavior change.

**`scripts/daily-sweep.js` has no overall wall-clock deadline — OPEN, found 2026-07-31, not fixed**
- The script tracks elapsed time (`startedAt` at `:215`, `durationMs` at `:298`) purely to *report* it; a grep for `timeout` in the file returns nothing, and it passes no `timeoutMs` into `extractMemories`. Its 23:45 launchd slot has no `ExitTimeOut`-style bound either.
- The Stop hook has exactly this bound (50000ms, honored end-to-end since PR #96's budget propagation) — the sweep, which processes strictly more material, has none.
- Impact: at the raised local-model timeout (`localTimeoutMs: 900000`) and ~86 tok/s cold prefill, a multi-chunk sweep can run for hours and overlap the next night's run. The extraction-wide deadline plumbing already exists; the sweep just never passes one.
- Fix approach: pass a `timeoutMs` budget from `daily-sweep.js` into `extractMemories` (the mechanism landed in PR #96 — the sweep is the caller that should use it).

**Interactive `/today` echo can print pre-redaction text — ACCEPTED RESIDUAL**
- `src/today-command.js:403-414`: `vaultWrite()` returns only `{decision:'WRITTEN', path}` on the SANITIZED path (`src/vault-gateway.js:484-485,535`) — the sanitized content itself is never handed back to the caller.
- `written` stays bound to the original `briefing` variable, so when the gateway redacts ≤half the paragraphs (partial contamination) instead of quarantining, the file on disk is clean but the in-process `written`/console echo still holds the pre-redaction body.
- Impact: contained to the interactive terminal echo of a single command; the persisted vault file is correctly sanitized either way.
- Fix approach: have `vaultWrite` return the sanitized `content` alongside `decision`/`path` on the SANITIZED branch, then have `today-command.js` use that returned text for `written` instead of the original `briefing`.

**`ARCHIVE_DIR` constant duplicated across 4 files — HYGIENE**
- Independently defined as `path.join(VAULT_ROOT(), 'archive', 'memory')` in `src/memory-proposals.js:28`, `src/promote-memories.js:21`, `scripts/validate-archive.js:18`, and `scripts/verify-baseline.js` (grep confirms the same literal), plus the name is echoed in `config/vault-paths.json`.
- Impact: none today — all four copies agree. Risk is drift if the archive path ever needs to move.
- Fix approach: extract to a single shared constant/export (e.g. in `vault-gateway.js` or a new small `paths.js`) — touches all 4+ call sites in one pass; not worth doing speculatively.

**Memory-pipeline internal writers bypass content/style guards — KNOWN, BOUNDED**
- `src/promote-memories.js` (`fs.writeFileSync` at lines 192, 267, 360, 444, 453, 650), `src/memory-proposals.js` (lines 155, 328, 361, 399), `src/dream.js` (lines 511, 816, 933, 939, 965), and `src/lifecycle.js` (lines 220, 247, 341) all write directly via raw `fs` to fixed RIGHT-side paths (`memory.md`, `memory-proposals.md`, archive files, dream changesets) instead of routing through `vaultWrite()`.
- Impact: bounded — these are already human-gated pipeline outputs (promotion requires explicit accept, dream apply is human-invoked-only per `npm run dream:apply`), not raw external input reaching the vault unchecked.
- Fix approach: none planned; routing through the gateway would add redundant guard overhead on already-vetted content.

**`src/memory-extractor.js` reads vault files via raw fs, bypassing the `vaultRead` allowlist**
- `src/memory-extractor.js:301,410,504,553` use `fs.readFileSync`/`fs.readdirSync` directly on vault-relative paths (transcripts, daily notes, memory files) rather than going through a `vaultRead` boundary check.
- Impact: read-only, so no write-boundary violation, but it means extraction can pull from any path the caller passes without the allowlist enforcement writes get.
- Fix approach: none urgent — no `vaultRead` gateway function currently exists to route through; would need to be added as a companion to `vaultWrite` if read-side allowlisting is ever required.

## Vault Hygiene

**One empty vault folder left of the five — MOSTLY RESOLVED 2026-07-31**
- `~/Claude Cowork/Untitled/`, `Daily Standups/`, `memory-archive/`, and `memory-proposals-archive/` are gone (verified by `find`), swept with 8 empty dirs in the 2026-07-31 vault triage (16 files moved, nothing deleted; log at `archive/dispatch/vault-triage-log.md`).
- Still present: `~/Claude Cowork/RIGHT/` — now holding a single `.DS_Store` and nothing else.
- Tracked daily by the `vault_hygiene` stats column; not blocking anything, pending Pete's manual cleanup.
- Fix approach: operator deletes when convenient; no code change needed.

**The unrouted quarantine is 97% of the vault's file count — MEASUREMENT SKEW, not debt**
- `~/Claude Cowork/archive/unrouted-quarantine-20260720/` holds 4,560 files / ~18 MB — about 97% of every file in the vault. A `README.md` manifest documenting it was added 2026-07-31, and the directory is excluded from Obsidian graph and search.
- Impact: any vault-wide file count (`find | wc -l`, a plugin's "N notes" readout, an ad-hoc size check) is dominated by inert dead-letters and says nothing about the live vault. `src/daily-stats.js`'s `vault_hygiene` column is *not* affected — it counts vault-root loose files plus top-level folders off the LEFT/RIGHT lists, and `archive` is an allowlisted RIGHT folder (`src/daily-stats.js:71-86`).
- Fix approach: none for the code. When quoting a vault file count in any doc or report, state whether the quarantine is included — the two numbers differ by ~30x.

**`source-ref::` provenance strings in `memory/memory.md` point at pre-restructure paths — INERT**
- At least 5 entries (`memory/memory.md:28,40,52,64,76`) carry `source-ref:: session-6X-*` values referencing session/path conventions from before the 2026-07-26 vault restructure (PR #93).
- Impact: none — these are provenance breadcrumbs, not resolved at read time by any code path. Inert metadata.
- Fix approach: no action needed unless a future feature starts resolving `source-ref::` against live paths.

## Scope Boundaries (not debt)

**`.planning/BACKLOG.md` items are current as of the 2026-07-21 audit**
- All open items (B-11, B-13, B-18, B-19) are explicitly dispositioned as DEFER/KEEP with evidence; nothing new surfaced in a fresh grep of `src/` and `scripts/` for `TODO|FIXME|HACK|XXX` beyond the pre-existing string literal at `src/memory-extractor.js:163` (`'- TODO items and task lists'`), which is descriptive text, not a marker.
- No action needed — backlog disposition stands.

---

*Concerns audit: 2026-07-31*
