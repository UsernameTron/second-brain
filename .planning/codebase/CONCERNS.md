# Codebase Concerns

**Analysis Date:** 2026-07-26

## Tech Debt

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

**Five empty vault folders await operator deletion — TRACKED**
- Confirmed still empty: `~/Claude Cowork/RIGHT/` (only a `.DS_Store` + empty `daily/` subfolder), `~/Claude Cowork/Untitled/`, `~/Claude Cowork/Daily Standups/`, `~/Claude Cowork/memory-archive/`, `~/Claude Cowork/memory-proposals-archive/`.
- Tracked daily by the `vault_hygiene` stats column; not blocking anything, pending Pete's manual cleanup.
- Fix approach: operator deletes when convenient; no code change needed.

**`source-ref::` provenance strings in `memory/memory.md` point at pre-restructure paths — INERT**
- At least 5 entries (`memory/memory.md:28,40,52,64,76`) carry `source-ref:: session-6X-*` values referencing session/path conventions from before the 2026-07-26 vault restructure (PR #93).
- Impact: none — these are provenance breadcrumbs, not resolved at read time by any code path. Inert metadata.
- Fix approach: no action needed unless a future feature starts resolving `source-ref::` against live paths.

## Scope Boundaries (not debt)

**`.planning/BACKLOG.md` items are current as of the 2026-07-21 audit**
- All open items (B-11, B-13, B-18, B-19) are explicitly dispositioned as DEFER/KEEP with evidence; nothing new surfaced in a fresh grep of `src/` and `scripts/` for `TODO|FIXME|HACK|XXX` beyond the pre-existing string literal at `src/memory-extractor.js:163` (`'- TODO items and task lists'`), which is descriptive text, not a marker.
- No action needed — backlog disposition stands.

---

*Concerns audit: 2026-07-26*
