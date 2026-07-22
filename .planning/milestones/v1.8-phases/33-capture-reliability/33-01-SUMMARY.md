# Plan 33-01 Summary — Launchd Reliability & Real-Fire Observation

**Status:** Complete
**Requirement:** CAP-LAUNCHD-01

## What shipped
- `config/com.secondbrain.daily-sweep.plist` — versioned source-of-truth (copied from the already-fixed installed plist; node@22 full path, WorkingDirectory, PATH env, log paths; **no LLM_PROVIDER** per locked decision). `plutil -lint` OK. Commit: (paired with 33-02, see phase commits).

## Root cause confirmed (not assumed)
The active launchd registration was **stale**: `launchctl print` showed `program = node` (bare, "inferred program") with `PATH => /usr/bin:/bin:/usr/sbin:/sbin` — no node@22 → spawn fails → `last exit code = 78: EX_CONFIG`, 0-byte log. The on-disk plist was already fixed but had never been rebootstrapped over the stale registration. Fix = version into `config/` + `launchctl bootout` + `bootstrap`.

## Real fire observed (the phase's first gate)
Rebootstrapped, truncated the log, `launchctl kickstart -k`:
- Active registration now runs `/opt/homebrew/opt/node@22/bin/node` (bare `node` gone).
- **`last exit code = 0`** (was 78).
- Log non-empty, ends `[daily-sweep] Sweep complete for 2026-07-21`.
- Fire results: transcript sweep 29 swept / **26 extracted**, inbox 0/0, retry {retried:2, succeeded:0, failed:2, frozen:1}, **26 candidates staged** (`WRITE_CANDIDATE WRITTEN`).

## Live finding (motivates 33-02/33-03)
The fire logged **3 `FALLBACK` events**: qwen memory-extraction classify calls (correlation-id: none) consistently wedged and hit PR #83's 60s local timeout, each falling back to claude-haiku-4-5. The sweep still exited 0 (memory-extractor handles `success:false`), but each wedge cost ~60s — the exact pathology 33-02 (health tracker) + 33-03 (degraded → skip-local fast path) eliminate: after 3 consecutive failures the classifier goes degraded and skips the local attempt entirely, so future sweeps won't burn 60s/item.

## Human-verify (deferred, non-blocking — recorded for VERIFICATION.md)
Tonight's scheduled **23:45** fire should run in launchd context, exit 0, and (after 33-04 ships) write `state/daily-sweep-last-run.json` + surface the `/today` sweep line. Confirm tomorrow via `launchctl print … | grep "last exit code"` and `cat state/daily-sweep-last-run.json`.
Caveat: the 23:45 fire needs the `haikuNightlyCap` schema patch applied before then, or `loadPipelineConfig` throws.

## Deviations
- Plan authored by planner; executed inline by the orchestrator (not a spawned gsd-executor) per user preference this session. Steps and gates followed verbatim.
- Kickstart poll hit its first 3-min ceiling (TIMEOUT) because the qwen wedges dragged the fire past 3 min; a second 9-min bounded poll confirmed `DONE-0`.
